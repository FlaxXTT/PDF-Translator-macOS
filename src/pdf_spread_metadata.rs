//! Keep navigation and annotations on the original panel of a bilingual spread.
use std::collections::{BTreeMap, HashMap, HashSet};

use lopdf::{Dictionary, Document, Object, ObjectId, dictionary};

use super::{Cancel, numbers, resolve};

pub(super) struct Placement {
    pub matrix: [f64; 6],
    pub panel: [f64; 4],
}

impl Placement {
    fn point(&self, x: f64, y: f64) -> [f64; 2] {
        let [a, b, c, d, e, f] = self.matrix;
        [a * x + c * y + e, b * x + d * y + f]
    }

    fn rect(&self, [x0, y0, x1, y1]: [f64; 4]) -> [f64; 4] {
        let [x0, y0] = self.point(x0, y0);
        let [x1, y1] = self.point(x1, y1);
        [x0.min(x1), y0.min(y1), x0.max(x1), y0.max(y1)]
    }

    fn rect_value(&self, document: &Document, value: &Object) -> Option<Object> {
        let coords = resolve(document, value).ok()?.as_array().ok()?;
        let [x0, y0, x1, y1] = coords.as_slice() else {
            return None;
        };
        Some(numbers(self.rect([
            number(document, x0)?,
            number(document, y0)?,
            number(document, x1)?,
            number(document, y1)?,
        ])))
    }
}

fn number(document: &Document, value: &Object) -> Option<f64> {
    let value = resolve(document, value).ok()?.as_float().ok()?;
    value.is_finite().then_some(f64::from(value))
}

fn dict<'a>(document: &'a Document, value: &'a Object) -> Option<&'a Dictionary> {
    resolve(document, value).ok()?.as_dict().ok()
}

fn array<'a>(document: &'a Document, value: &'a Object) -> Option<&'a [Object]> {
    Some(resolve(document, value).ok()?.as_array().ok()?.as_slice())
}

fn name(document: &Document, value: &Object) -> Option<Vec<u8>> {
    let value = resolve(document, value).ok()?;
    value
        .as_name()
        .or_else(|_| value.as_str())
        .ok()
        .map(<[u8]>::to_vec)
}

struct Navigation<'a> {
    pages: &'a [ObjectId],
    placements: &'a HashMap<ObjectId, Placement>,
    names: HashSet<Vec<u8>>,
}

impl Navigation<'_> {
    fn explicit(&self, document: &Document, value: &Object) -> Option<Object> {
        let value = resolve(document, value).ok()?;
        let value = if let Ok(dictionary) = value.as_dict() {
            resolve(document, dictionary.get(b"D").ok()?).ok()?
        } else {
            value
        };
        let [page, mode, coordinates @ ..] = value.as_array().ok()?.as_slice() else {
            return None;
        };
        let page = page.as_reference().ok().or_else(|| {
            self.pages
                .get(usize::try_from(page.as_i64().ok()?).ok()?)
                .copied()
        })?;
        let placement = self.placements.get(&page)?;
        let [a, b, c, d, e, f] = placement.matrix;
        let coordinate = |index| coordinates.get(index).and_then(|n| number(document, n));
        let transform = |value: Option<f64>, scale, offset| {
            value.map_or(Object::Null, |n| Object::Real((n * scale + offset) as f32))
        };
        let swapped = a == 0.;
        let mut output = vec![Object::Reference(page), mode.clone()];
        match mode.as_name().ok()? {
            b"XYZ" => {
                let (x, y) = (coordinate(0), coordinate(1));
                if swapped {
                    output.extend([transform(y, c, e), transform(x, b, f)]);
                } else {
                    output.extend([transform(x, a, e), transform(y, d, f)]);
                }
                output.push(transform(coordinate(2), 1., 0.));
            }
            b"Fit" | b"FitB" => {
                output[1] = "FitR".into();
                output.extend(numbers(placement.panel).as_array().ok()?.iter().cloned());
            }
            b"FitH" | b"FitBH" if swapped => {
                output[1] = if mode.as_name().ok()? == b"FitH" {
                    "FitV"
                } else {
                    "FitBV"
                }
                .into();
                output.push(transform(coordinate(0), c, e));
            }
            b"FitV" | b"FitBV" if swapped => {
                output[1] = if mode.as_name().ok()? == b"FitV" {
                    "FitH"
                } else {
                    "FitBH"
                }
                .into();
                output.push(transform(coordinate(0), b, f));
            }
            b"FitH" | b"FitBH" => output.push(transform(coordinate(0), d, f)),
            b"FitV" | b"FitBV" => output.push(transform(coordinate(0), a, e)),
            b"FitR" => {
                let rect = placement.rect([
                    coordinate(0)?,
                    coordinate(1)?,
                    coordinate(2)?,
                    coordinate(3)?,
                ]);
                output.extend(numbers(rect).as_array().ok()?.iter().cloned());
            }
            _ => return None,
        }
        Some(Object::Array(output))
    }

    fn destination(&self, document: &Document, value: &Object) -> Option<Object> {
        if let Some(key) = name(document, value) {
            self.names
                .contains(&key)
                .then(|| resolve(document, value).ok().cloned())
                .flatten()
        } else {
            self.explicit(document, value)
        }
    }

    fn action(&self, document: &Document, value: &Object, depth: usize) -> Option<Object> {
        if depth == 0 {
            return None;
        }
        let mut action = dict(document, value)?.clone();
        if action.get(b"S").and_then(Object::as_name).ok() == Some(b"GoTo") {
            action.set("D", self.destination(document, action.get(b"D").ok()?)?);
        }
        if let Ok(next) = action.get(b"Next") {
            let actions = if let Some(list) = array(document, next) {
                let list: Vec<_> = list
                    .iter()
                    .filter_map(|entry| self.action(document, entry, depth - 1))
                    .collect();
                (!list.is_empty()).then_some(Object::Array(list))
            } else {
                self.action(document, next, depth - 1)
            };
            update(&mut action, b"Next", actions);
        }
        Some(action.into())
    }

    fn rewrite(&self, document: &Document, owner: &mut Dictionary) {
        if let Ok(value) = owner.get(b"Dest") {
            let destination = self.destination(document, value);
            update(owner, b"Dest", destination);
        }
        if let Ok(value) = owner.get(b"A") {
            let action = self.action(document, value, 32);
            update(owner, b"A", action);
        }
        if let Some(actions) = owner
            .get(b"AA")
            .ok()
            .and_then(|value| dict(document, value))
        {
            let mut updated = Dictionary::new();
            for (event, action) in actions.iter() {
                if let Some(action) = self.action(document, action, 32) {
                    updated.set(event.clone(), action);
                }
            }
            update(owner, b"AA", (!updated.is_empty()).then(|| updated.into()));
        }
    }
}

fn update(dictionary: &mut Dictionary, key: &[u8], value: Option<Object>) {
    if let Some(value) = value {
        dictionary.set(key.to_vec(), value);
    } else {
        dictionary.remove(key);
    }
}

/// Flatten the destination name tree while updating coordinates and pruning omitted targets.
fn named_destinations(
    document: &Document,
    tree: &Object,
    navigation: &Navigation<'_>,
    cancel: &Cancel<'_>,
) -> Result<BTreeMap<Vec<u8>, Object>, String> {
    let mut todo = vec![tree];
    let mut visited = HashSet::new();
    let mut result = BTreeMap::new();
    while let Some(node) = todo.pop() {
        cancel.check()?;
        if node.as_reference().is_ok_and(|id| !visited.insert(id)) {
            continue;
        }
        let Some(node) = dict(document, node) else {
            continue;
        };
        if let Some(kids) = node
            .get(b"Kids")
            .ok()
            .and_then(|kids| array(document, kids))
        {
            todo.extend(kids);
        }
        if let Some(names) = node
            .get(b"Names")
            .ok()
            .and_then(|names| array(document, names))
        {
            for pair in names.chunks_exact(2) {
                if let (Some(key), Some(dest)) = (
                    name(document, &pair[0]),
                    navigation.explicit(document, &pair[1]),
                ) {
                    result.insert(key, dest);
                }
            }
        }
    }
    Ok(result)
}

pub(super) fn preserve(
    document: &mut Document,
    root: ObjectId,
    pages: &[ObjectId],
    placements: &HashMap<ObjectId, Placement>,
    cancel: &Cancel<'_>,
) -> Result<(), String> {
    let mut navigation = Navigation {
        pages,
        placements,
        names: HashSet::new(),
    };
    let mut catalog = document
        .get_dictionary(root)
        .map_err(super::display)?
        .clone();
    if let Some(legacy) = catalog.get(b"Dests").ok().and_then(|v| dict(document, v)) {
        let mut updated = Dictionary::new();
        for (key, value) in legacy.iter() {
            if let Some(value) = navigation.explicit(document, value) {
                navigation.names.insert(key.clone());
                updated.set(key.clone(), value);
            }
        }
        update(
            &mut catalog,
            b"Dests",
            (!updated.is_empty()).then(|| updated.into()),
        );
    }
    if let Some(names) = catalog.get(b"Names").ok().and_then(|v| dict(document, v)) {
        let mut names = names.clone();
        if let Ok(value) = names.get(b"Dests") {
            let mapped = named_destinations(document, value, &navigation, cancel)?;
            navigation.names.extend(mapped.keys().cloned());
            let flat: Vec<_> = mapped
                .into_iter()
                .flat_map(|(key, value)| [Object::string_literal(key), value])
                .collect();
            update(
                &mut names,
                b"Dests",
                (!flat.is_empty()).then(|| dictionary! { "Names" => flat }.into()),
            );
            catalog.set("Names", names);
        }
    }
    if let Ok(value) = catalog.get(b"OpenAction") {
        let rewritten = if dict(document, value).is_some() {
            navigation.action(document, value, 32)
        } else {
            navigation.destination(document, value)
        };
        update(&mut catalog, b"OpenAction", rewritten);
    }
    let mut outlines = catalog
        .get(b"Outlines")
        .and_then(Object::as_reference)
        .into_iter()
        .collect::<Vec<_>>();
    *document.get_dictionary_mut(root).map_err(super::display)? = catalog;
    let mut visited = HashSet::new();
    while let Some(id) = outlines.pop() {
        cancel.check()?;
        if !visited.insert(id) {
            continue;
        }
        let Ok(outline) = document.get_dictionary(id) else {
            continue;
        };
        outlines.extend(
            [b"First".as_slice(), b"Next"]
                .into_iter()
                .filter_map(|key| outline.get(key).and_then(Object::as_reference).ok()),
        );
        let mut outline = outline.clone();
        navigation.rewrite(document, &mut outline);
        document.objects.insert(id, outline.into());
    }

    let mut visited = HashSet::new();
    for &page in pages {
        let Some(placement) = placements.get(&page) else {
            continue;
        };
        cancel.check()?;
        let annotations = document
            .get_dictionary(page)
            .ok()
            .and_then(|page| array(document, page.get(b"Annots").ok()?))
            .map(<[Object]>::to_vec);
        let Some(annotations) = annotations else {
            continue;
        };
        let mut kept = Vec::with_capacity(annotations.len());
        let mut popups = Vec::new();
        for value in annotations {
            cancel.check()?;
            if let Some(value) = annotation(
                document,
                page,
                value,
                placement,
                &navigation,
                &mut visited,
                &mut popups,
            ) {
                kept.push(value);
            }
        }
        while let Some(popup) = popups.pop() {
            cancel.check()?;
            annotation(
                document,
                page,
                popup,
                placement,
                &navigation,
                &mut visited,
                &mut popups,
            );
        }
        document
            .get_dictionary_mut(page)
            .map_err(super::display)?
            .set("Annots", kept);
    }
    Ok(())
}

fn points(document: &Document, value: &Object, placement: &Placement) -> Option<Object> {
    let coords = array(document, value)?;
    if coords.len() % 2 != 0 {
        return None;
    }
    let points = coords
        .chunks_exact(2)
        .map(|pair| Some(placement.point(number(document, &pair[0])?, number(document, &pair[1])?)))
        .collect::<Option<Vec<_>>>()?;
    Some(Object::Array(
        points
            .into_iter()
            .flatten()
            .map(|n| Object::Real(n as f32))
            .collect(),
    ))
}

fn appearance(
    document: &mut Document,
    value: &Object,
    placement: &Placement,
    depth: usize,
) -> Option<Object> {
    if depth == 0 {
        return None;
    }
    let [a, b, c, d, _, _] = placement.matrix;
    if a > 0. && d > 0. {
        return Some(value.clone());
    }
    let value = resolve(document, value).ok()?.clone();
    match value {
        Object::Dictionary(mut map) => {
            for (_, value) in map.iter_mut() {
                *value = appearance(document, value, placement, depth - 1)?;
            }
            Some(map.into())
        }
        Object::Stream(mut stream) => {
            let entries = stream
                .dict
                .get(b"Matrix")
                .ok()
                .and_then(|m| array(document, m));
            let matrix = entries
                .and_then(|m| {
                    let values = m
                        .iter()
                        .map(|n| number(document, n))
                        .collect::<Option<Vec<_>>>()?;
                    <[f64; 6]>::try_from(values).ok()
                })
                .unwrap_or([1., 0., 0., 1., 0., 0.]);
            let scale = a.hypot(b);
            let [p, q, r, s, t, u] = matrix;
            stream.dict.set(
                "Matrix",
                numbers([
                    (a * p + c * q) / scale,
                    (b * p + d * q) / scale,
                    (a * r + c * s) / scale,
                    (b * r + d * s) / scale,
                    (a * t + c * u) / scale,
                    (b * t + d * u) / scale,
                ]),
            );
            Some(document.add_object(Object::Stream(stream)).into())
        }
        _ => None,
    }
}

fn annotation(
    document: &mut Document,
    page: ObjectId,
    value: Object,
    placement: &Placement,
    navigation: &Navigation<'_>,
    visited: &mut HashSet<ObjectId>,
    popups: &mut Vec<Object>,
) -> Option<Object> {
    let id = value.as_reference().ok();
    if id.is_some_and(|id| !visited.insert(id)) {
        return Some(value);
    }
    let mut annotation = dict(document, &value)?.clone();
    if let Ok(rect) = annotation.get(b"Rect") {
        if let Some(rect) = placement.rect_value(document, rect) {
            annotation.set("Rect", rect);
        }
    }
    annotation.set("P", page);
    for key in [b"QuadPoints".as_slice(), b"Vertices", b"L", b"CL"] {
        if let Some(mapped) = annotation
            .get(key)
            .ok()
            .and_then(|v| points(document, v, placement))
        {
            annotation.set(key.to_vec(), mapped);
        }
    }
    if let Some(ink) = annotation
        .get(b"InkList")
        .ok()
        .and_then(|v| array(document, v))
    {
        let strokes: Vec<_> = ink
            .iter()
            .filter_map(|v| points(document, v, placement))
            .collect();
        annotation.set("InkList", strokes);
    }
    if let Ok(value) = annotation.get(b"AP") {
        if let Some(mapped) = appearance(document, value, placement, 4) {
            annotation.set("AP", mapped);
        }
    }
    if let Ok(popup) = annotation.get(b"Popup") {
        if popup.as_reference().is_ok() {
            popups.push(popup.clone());
        }
    }
    navigation.rewrite(document, &mut annotation);
    let id = if let Some(id) = id {
        document.objects.insert(id, annotation.into());
        id
    } else {
        document.add_object(annotation)
    };
    Some(id.into())
}
