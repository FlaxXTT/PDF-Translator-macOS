use babeldoc_ir_core::ReadOnlyView;
use lopdf::{Dictionary, Document, Object, Stream, content::Content, dictionary};

#[test]
fn rotated_page_uses_visual_coordinates_and_keeps_sideways_glyphs() {
    let mut pdf = Document::with_version("1.7");
    let pages = pdf.new_object_id();
    let font = pdf.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "Type1",
        "BaseFont" => "Helvetica",
    });
    let stream = pdf.add_object(Stream::new(
        Dictionary::new(),
        b"BT /H 12 Tf 0 1 -1 0 40 45 Tm (A) Tj 1 0 0 1 80 100 Tm (B) Tj ET".to_vec(),
    ));
    let page = pdf.add_object(dictionary! {
        "Type" => "Page",
        "Parent" => pages,
        "MediaBox" => vec![0.into(), 0.into(), 120.into(), 240.into()],
        "CropBox" => vec![10.into(), 20.into(), 110.into(), 210.into()],
        "Resources" => dictionary! { "Font" => dictionary! { "H" => font } },
        "Contents" => stream,
    });
    pdf.objects.insert(
        pages,
        dictionary! {
            "Type" => "Pages",
            "Count" => 1,
            "Kids" => vec![Object::Reference(page)],
            "Rotate" => 90,
        }
        .into(),
    );
    let catalog = pdf.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages });
    pdf.trailer.set("Root", catalog);
    let transform = super::output::display_transform(&pdf, page)
        .unwrap()
        .unwrap();
    assert_eq!(transform, ([190., 100.], [0., -1., 1., 0., -20., 110.]));
    let directory = tempfile::tempdir().unwrap();
    let input = directory.path().join("rotated.pdf");
    pdf.save(&input).unwrap();

    let mut document = babeldoc_parser_core::parse(
        &input,
        babeldoc_parser_core::Config {
            normalize_page_geometry: true,
            display_transforms: [(0, transform)].into(),
            ..Default::default()
        },
    )
    .unwrap()
    .document;
    let view = document.view::<ReadOnlyView>();
    let page = view
        .document()
        .page_iter(&view)
        .unwrap()
        .next()
        .unwrap()
        .unwrap();
    let characters = page
        .pdf_character_iter(&view)
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert_eq!(characters[0].vertical(&view).unwrap(), Some(false));
    assert_eq!(characters[1].vertical(&view).unwrap(), Some(true));
    let output = babeldoc_writer_core::build_page_output(
        &view,
        &page,
        &babeldoc_writer_core::BuildOptions {
            keep_cardinal_orientation: true,
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(
        text_matrices(&output.stream),
        [
            vec![1., 0., 0., 1., 25., 70.],
            vec![0., -1., 1., 0., 80., 30.]
        ]
    );
}

#[test]
fn liberation_mono_prose_is_not_classified_as_a_formula_font() {
    use babeldoc_p2_stages::shared::formula_helper::is_formulas_font;
    use std::collections::BTreeSet;

    assert!(!is_formulas_font("AAAAAA+LiberationMono", None).unwrap());
    assert!(is_formulas_font("AAAAAA+STIXTwoMath-Regular", None).unwrap());
    let explicit = BTreeSet::from(["LiberationMono".into()]);
    assert!(is_formulas_font("AAAAAA+LiberationMono", Some(&explicit)).unwrap());
}

#[test]
fn rebuilt_type3_glyphs_keep_their_individual_orientation() {
    let mut pdf = Document::with_version("1.7");
    let pages = pdf.new_object_id();
    let glyph = pdf.add_object(Stream::new(
        Dictionary::new(),
        b"500 0 0 0 500 1000 d1 0 0 500 1000 re f".to_vec(),
    ));
    let font = pdf.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "Type3",
        "FontBBox" => vec![0.into(), 0.into(), 500.into(), 1000.into()],
        "FontMatrix" => vec![0.001.into(), 0.into(), 0.into(), (-0.001).into(), 0.into(), 0.into()],
        "CharProcs" => dictionary! { "A" => glyph },
        "Encoding" => dictionary! { "Differences" => vec![65.into(), Object::Name(b"A".to_vec())] },
        "FirstChar" => 65,
        "LastChar" => 65,
        "Widths" => vec![500.into()],
    });
    let stream = pdf.add_object(Stream::new(
        Dictionary::new(),
        b"BT /T 1 Tf 10 0 0 -10 30 90 Tm (A) Tj 10 0 0 10 30 50 Tm (A) Tj ET".to_vec(),
    ));
    let page = pdf.add_object(dictionary! {
        "Type" => "Page",
        "Parent" => pages,
        "MediaBox" => vec![0.into(), 0.into(), 120.into(), 120.into()],
        "Resources" => dictionary! { "Font" => dictionary! { "T" => font } },
        "Contents" => stream,
    });
    pdf.objects.insert(
        pages,
        dictionary! {
            "Type" => "Pages",
            "Count" => 1,
            "Kids" => vec![Object::Reference(page)],
        }
        .into(),
    );
    let catalog = pdf.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages });
    pdf.trailer.set("Root", catalog);
    let directory = tempfile::tempdir().unwrap();
    let input = directory.path().join("type3.pdf");
    pdf.save(&input).unwrap();

    let mut document = babeldoc_parser_core::parse(
        &input,
        babeldoc_parser_core::Config {
            preserve_type3_orientation: true,
            decode_pages_incrementally: true,
            ..Default::default()
        },
    )
    .unwrap()
    .document;
    let view = document.view::<ReadOnlyView>();
    let page = view
        .document()
        .page_iter(&view)
        .unwrap()
        .next()
        .unwrap()
        .unwrap();
    let output =
        babeldoc_writer_core::build_page_output(&view, &page, &Default::default()).unwrap();
    assert_eq!(
        text_matrices(&output.stream),
        [
            vec![1., 0., 0., -1., 30., 90.],
            vec![1., 0., 0., 1., 30., 50.]
        ]
    );
}

fn text_matrices(stream: &[u8]) -> Vec<Vec<f32>> {
    Content::decode(stream)
        .unwrap()
        .operations
        .into_iter()
        .filter(|operation| operation.operator == "Tm")
        .map(|operation| {
            operation
                .operands
                .iter()
                .map(|value| value.as_float().unwrap())
                .collect::<Vec<_>>()
        })
        .collect()
}
