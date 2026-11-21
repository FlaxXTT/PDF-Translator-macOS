use std::collections::BTreeSet;
use std::sync::atomic::AtomicBool;

use lopdf::{Dictionary, Document, Object, ObjectId, Stream, dictionary};

use super::{Cancel, PdfOptions, compose_dual, numbers};

fn fixture() -> (Document, [ObjectId; 3], ObjectId, ObjectId) {
    let mut pdf = Document::with_version("1.7");
    let pages = pdf.new_object_id();
    let mut page = || {
        pdf.add_object(dictionary! {
            "Type" => "Page", "Parent" => pages,
            "MediaBox" => numbers([0., 0., 200., 300.]),
        })
    };
    let [a, b, c] = [page(), page(), page()];
    let rotated = pdf.get_dictionary_mut(b).unwrap();
    rotated.set("CropBox", numbers([10., 20., 190., 280.]));
    rotated.set("Rotate", 90);
    rotated.set("UserUnit", 2);
    pdf.objects.insert(
        pages,
        dictionary! {
            "Type" => "Pages", "Count" => 3, "Kids" => vec![Object::from(a), b.into(), c.into()],
        }
        .into(),
    );
    let jump = vec![
        Object::from(b),
        "XYZ".into(),
        35.into(),
        100.into(),
        Object::Null,
    ];
    let toc = pdf.add_object(dictionary! {
        "Subtype" => "Link", "Rect" => numbers([15., 25., 65., 45.]),
        "Dest" => Object::string_literal("section"),
    });
    let uri = pdf.add_object(dictionary! {
        "Subtype" => "Link", "Rect" => numbers([15., 60., 70., 80.]),
        "A" => dictionary! { "S" => "URI", "URI" => Object::string_literal("https://example.org/reference") },
    });
    let omitted = pdf.add_object(dictionary! {
        "Subtype" => "Link", "Rect" => numbers([15., 90., 70., 110.]),
        "Dest" => vec![Object::from(c), "Fit".into()],
    });
    let fit = pdf.add_object(dictionary! {
        "Subtype" => "Link", "Rect" => numbers([15., 120., 70., 145.]),
        "A" => dictionary! { "S" => "GoTo", "D" => vec![Object::from(b), "FitH".into(), 100.into()] },
    });
    let highlight = pdf.new_object_id();
    let popup = pdf.add_object(dictionary! {
        "Subtype" => "Popup", "Rect" => numbers([80., 35., 110., 80.]), "Parent" => highlight,
    });
    let ap = pdf.add_object(Stream::new(
        dictionary! {
            "Type" => "XObject", "Subtype" => "Form", "BBox" => numbers([0., 0., 30., 20.]),
            "Resources" => Dictionary::new(),
        },
        b"1 1 0 rg 0 0 30 20 re f".to_vec(),
    ));
    pdf.objects.insert(highlight, dictionary! {
        "Subtype" => "Highlight", "Rect" => numbers([15., 30., 45., 50.]), "Popup" => popup,
        "QuadPoints" => numbers([15., 50., 45., 50., 15., 30., 45., 30.]),
        "Contents" => Object::string_literal("Reader comment"), "AP" => dictionary! { "N" => ap },
    }.into());
    pdf.get_dictionary_mut(a).unwrap().set(
        "Annots",
        vec![Object::from(toc), uri.into(), omitted.into(), fit.into()],
    );
    pdf.get_dictionary_mut(b)
        .unwrap()
        .set("Annots", vec![Object::from(highlight), popup.into()]);
    let outline = pdf.add_object(
        dictionary! { "Title" => Object::string_literal("Table"), "Dest" => jump.clone() },
    );
    let outlines =
        pdf.add_object(dictionary! { "First" => outline, "Last" => outline, "Count" => 1 });
    pdf.get_dictionary_mut(outline)
        .unwrap()
        .set("Parent", outlines);
    let leaf = pdf.add_object(dictionary! {
        "Names" => vec![
            Object::string_literal("omit"), Object::Array(vec![c.into(), "Fit".into()]),
            Object::string_literal("section"), dictionary! {"D" => jump}.into(),
        ],
    });
    let root = pdf.add_object(dictionary! {
        "Type" => "Catalog", "Pages" => pages, "Outlines" => outlines,
        "Names" => dictionary! { "Dests" => dictionary! { "Kids" => vec![Object::from(leaf)] } },
    });
    pdf.trailer.set("Root", root);
    (pdf, [a, b, c], highlight, popup)
}

#[test]
fn spread_remaps_named_links_outlines_and_comments_in_both_orders() {
    for translated_first in [false, true] {
        let (pdf, [a, b, _], highlight, popup) = fixture();
        let options = PdfOptions {
            translated_first,
            only_selected: true,
            ..PdfOptions::default()
        };
        let spread = compose_dual(
            pdf.clone(),
            &pdf,
            &BTreeSet::from([0, 1]),
            &options,
            &Cancel(&AtomicBool::new(false)),
        )
        .unwrap();
        let root = spread.catalog().unwrap();
        let names = root
            .get(b"Names")
            .unwrap()
            .as_dict()
            .unwrap()
            .get(b"Dests")
            .unwrap()
            .as_dict()
            .unwrap()
            .get(b"Names")
            .unwrap()
            .as_array()
            .unwrap();
        assert_eq!(names.len(), 2);
        assert_eq!(names[0].as_str().unwrap(), b"section");
        let x: f64 = if translated_first { 520. } else { 0. };
        let target = vec![
            b.into(),
            "XYZ".into(),
            Object::Real((x + 160.) as f32),
            Object::Real(310.),
            Object::Null,
        ];
        assert_eq!(names[1], Object::Array(target.clone()));
        let outline = spread
            .get_dictionary(root.get(b"Outlines").unwrap().as_reference().unwrap())
            .unwrap();
        let outline_entry = spread
            .get_dictionary(outline.get(b"First").unwrap().as_reference().unwrap())
            .unwrap();
        assert_eq!(outline_entry.get(b"Dest").unwrap(), &Object::Array(target));

        let page = spread.get_dictionary(a).unwrap();
        let annotations = page.get(b"Annots").unwrap().as_array().unwrap();
        let items: Vec<_> = annotations
            .iter()
            .map(|id| spread.get_dictionary(id.as_reference().unwrap()).unwrap())
            .collect();
        assert_eq!(items[0].get(b"Dest").unwrap().as_str().unwrap(), b"section");
        let left = if translated_first { 200. } else { 0. };
        assert_eq!(
            items[0].get(b"Rect").unwrap(),
            &numbers([15. + left, 25., 65. + left, 45.])
        );
        assert_eq!(
            items[1]
                .get(b"A")
                .unwrap()
                .as_dict()
                .unwrap()
                .get(b"URI")
                .unwrap()
                .as_str()
                .unwrap(),
            b"https://example.org/reference"
        );
        assert!(!items[2].has(b"Dest"));
        let fit = items[3]
            .get(b"A")
            .unwrap()
            .as_dict()
            .unwrap()
            .get(b"D")
            .unwrap()
            .as_array()
            .unwrap();
        assert_eq!(fit, &vec![b.into(), "FitV".into(), Object::Real((x + 160.) as f32)]);

        let note = spread.get_dictionary(highlight).unwrap();
        assert_eq!(
            note.get(b"Contents").unwrap().as_str().unwrap(),
            b"Reader comment"
        );
        assert_eq!(
            note.get(b"Rect").unwrap(),
            &numbers([x + 20., 290., x + 60., 350.])
        );
        assert_eq!(
            note.get(b"QuadPoints").unwrap(),
            &numbers([x + 60., 350., x + 60., 290., x + 20., 350., x + 20., 290.])
        );
        assert_eq!(note.get(b"Popup").unwrap().as_reference().unwrap(), popup);
        assert_eq!(
            spread
                .get_dictionary(popup)
                .unwrap()
                .get(b"Parent")
                .unwrap()
                .as_reference()
                .unwrap(),
            highlight
        );
    }
}
