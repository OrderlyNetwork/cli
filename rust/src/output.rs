//! Output formatting mirroring `src/lib/output.ts` (JSON unwrap + CSV flattening).

use crate::colors;
use crate::error::OutputError;
use serde_json::{Map, Value};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputFormat {
    Json,
    Csv,
}

/// The TS CLI scans raw argv for `--pretty` rather than relying on parsed flags.
pub fn is_pretty_json() -> bool {
    std::env::args().any(|a| a == "--pretty")
}

/// Mirrors `unwrapResponse`: unwrap `{success, data}` envelopes unless
/// `success === false`.
pub fn unwrap_response(response: &Value) -> Value {
    if let Value::Object(o) = response {
        if o.contains_key("data") {
            if o.get("success") == Some(&Value::Bool(false)) {
                return response.clone();
            }
            return o.get("data").cloned().unwrap_or(Value::Null);
        }
    }
    response.clone()
}

fn value_to_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => js_number_to_string(n),
        Value::Null => "null".to_string(),
        other => serde_json::to_string(other).unwrap_or_default(),
    }
}

fn js_number_to_string(n: &serde_json::Number) -> String {
    if let Some(i) = n.as_i64() {
        return i.to_string();
    }
    if let Some(u) = n.as_u64() {
        return u.to_string();
    }
    js_f64_to_string(n.as_f64().unwrap_or(f64::NAN))
}

/// Format an f64 the way JS `String(number)` does for the common cases.
pub fn js_f64_to_string(n: f64) -> String {
    if n.is_nan() {
        return "NaN".to_string();
    }
    if n == f64::INFINITY {
        return "Infinity".to_string();
    }
    if n == f64::NEG_INFINITY {
        return "-Infinity".to_string();
    }
    if n == 0.0 {
        return "0".to_string();
    }
    let abs = n.abs();
    if abs >= 1e21 || abs < 1e-6 {
        // Exponential form; JS always includes an explicit exponent sign.
        let s = format!("{:e}", n);
        return match s.split_once('e') {
            Some((mantissa, exp)) => {
                let sign = if exp.starts_with('-') { "" } else { "+" };
                format!("{mantissa}e{sign}{exp}")
            }
            None => s,
        };
    }
    let s = format!("{n}");
    if s.contains('e') || s.contains('E') {
        // Rust only uses exponential for very large/small; normalise the sign.
        if let Some((m, e)) = s.split_once(['e', 'E']) {
            let sign = if e.starts_with('-') { "" } else { "+" };
            return format!("{m}e{sign}{e}");
        }
    }
    s
}

fn escape_csv_value(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

fn extract_rows(data: &Value) -> Value {
    let obj = match data.as_object() {
        Some(o) => o,
        None => return data.clone(),
    };

    for key in ["rows", "list", "data"] {
        if let Some(v) = obj.get(key) {
            if v.is_array() {
                return v.clone();
            }
            if v.is_null() {
                return Value::Array(vec![]);
            }
        }
    }

    let keys: Vec<&String> = obj.keys().collect();
    let array_keys: Vec<&String> = keys
        .iter()
        .filter(|k| obj.get(**k).map(|v| v.is_array()).unwrap_or(false))
        .cloned()
        .collect();
    if array_keys.len() == 1 && keys.len() <= 2 {
        return obj.get(array_keys[0]).cloned().unwrap_or(Value::Null);
    }

    data.clone()
}

fn flatten_object(
    obj: &Map<String, Value>,
    prefix: &str,
    schema: Option<&HashMap<String, Vec<String>>>,
    out: &mut Map<String, Value>,
) {
    for (key, value) in obj {
        let new_key = if prefix.is_empty() {
            key.clone()
        } else {
            format!("{prefix}.{key}")
        };

        match value {
            Value::Null => {
                if let Some(cks) = schema.and_then(|s| s.get(&new_key)) {
                    if !cks.is_empty() {
                        for ck in cks {
                            out.insert(format!("{new_key}.{ck}"), Value::String(String::new()));
                        }
                        continue;
                    }
                }
                out.insert(new_key, Value::String(String::new()));
            }
            Value::Object(m) => flatten_object(m, &new_key, schema, out),
            Value::Array(arr) => {
                let has_objects = arr.iter().any(|i| i.is_object());
                if has_objects {
                    let mut obj_idx = 0usize;
                    for item in arr {
                        if let Value::Object(m) = item {
                            flatten_object(m, &format!("{new_key}.{obj_idx}"), schema, out);
                            obj_idx += 1;
                        }
                    }
                } else {
                    out.insert(
                        new_key,
                        Value::String(serde_json::to_string(value).unwrap_or_default()),
                    );
                }
            }
            _ => {
                out.insert(new_key, Value::String(value_to_string(value)));
            }
        }
    }
}

fn collect_object_schema(value: &Value, prefix: &str, schema: &mut HashMap<String, Vec<String>>) {
    let obj = match value.as_object() {
        Some(o) => o,
        None => return,
    };

    for (key, val) in obj {
        let full_key = if prefix.is_empty() {
            key.clone()
        } else {
            format!("{prefix}.{key}")
        };

        match val {
            Value::Object(m) => {
                let child_keys: Vec<String> = m.keys().cloned().collect();
                schema.insert(full_key.clone(), child_keys);
                let mut nested = HashMap::new();
                collect_object_schema(val, &full_key, &mut nested);
                merge_schema(schema, nested);
            }
            Value::Array(arr) if arr.iter().any(|i| i.is_object()) => {
                schema.insert(full_key.clone(), vec!["0".to_string()]);
                for (i, item) in arr.iter().enumerate() {
                    if !item.is_object() {
                        continue;
                    }
                    let indexed_key = format!("{full_key}.{i}");
                    let child_keys: Vec<String> =
                        item.as_object().unwrap().keys().cloned().collect();
                    schema.insert(indexed_key.clone(), child_keys);
                    let mut nested = HashMap::new();
                    collect_object_schema(item, &indexed_key, &mut nested);
                    merge_schema(schema, nested);
                }
            }
            _ => {}
        }
    }
}

fn merge_schema(schema: &mut HashMap<String, Vec<String>>, nested: HashMap<String, Vec<String>>) {
    for (k, v) in nested {
        match schema.get_mut(&k) {
            Some(existing) => {
                for c in v {
                    if !existing.contains(&c) {
                        existing.push(c);
                    }
                }
            }
            None => {
                schema.insert(k, v);
            }
        }
    }
}

pub fn to_csv(data: &Value) -> String {
    let rows = extract_rows(data);

    if let Value::Array(arr) = &rows {
        if arr.is_empty() {
            return String::new();
        }

        let mut schema: HashMap<String, Vec<String>> = HashMap::new();
        for item in arr {
            if item.is_object() {
                let mut item_schema: HashMap<String, Vec<String>> = HashMap::new();
                collect_object_schema(item, "", &mut item_schema);
                merge_schema(&mut schema, item_schema);
            }
        }

        let mut all_keys: Vec<String> = Vec::new();
        let mut flat_rows: Vec<Map<String, Value>> = Vec::new();
        for item in arr {
            if let Value::Object(m) = item {
                let mut flat = Map::new();
                flatten_object(m, "", Some(&schema), &mut flat);
                for k in flat.keys() {
                    if !all_keys.contains(k) {
                        all_keys.push(k.clone());
                    }
                }
                flat_rows.push(flat);
            }
        }

        let mut lines = vec![all_keys.join(",")];
        for flat in &flat_rows {
            let values: Vec<String> = all_keys
                .iter()
                .map(|k| escape_csv_value(flat.get(k).and_then(|v| v.as_str()).unwrap_or("")))
                .collect();
            lines.push(values.join(","));
        }
        return lines.join("\n");
    }

    if let Value::Object(m) = &rows {
        let mut flat = Map::new();
        flatten_object(m, "", None, &mut flat);
        let keys: Vec<String> = flat.keys().cloned().collect();
        let line: Vec<String> = keys
            .iter()
            .map(|k| escape_csv_value(flat.get(k).and_then(|v| v.as_str()).unwrap_or("")))
            .collect();
        return format!("{}\n{}", keys.join(","), line.join(","));
    }

    value_to_string(&rows)
}

/// Render a command result to `(stdout, stderr)`, mirroring `output()`.
pub fn render(data: &Value, format: OutputFormat, pretty: bool) -> (String, String) {
    let unwrapped = unwrap_response(data);
    match format {
        OutputFormat::Csv => {
            let csv = to_csv(&unwrapped);
            if !csv.is_empty() {
                (csv, String::new())
            } else {
                (String::new(), colors::dim("(no data)"))
            }
        }
        OutputFormat::Json => {
            let s = if pretty {
                serde_json::to_string_pretty(&unwrapped)
            } else {
                serde_json::to_string(&unwrapped)
            };
            (s.unwrap_or_default(), String::new())
        }
    }
}

/// Print a command result. Mirrors `output()`.
pub fn output(data: &Value, format: OutputFormat) {
    let (out, err) = render(data, format, is_pretty_json());
    if !out.is_empty() {
        println!("{out}");
    }
    if !err.is_empty() {
        eprintln!("{err}");
    }
}

const SYMBOL_PATTERN: &str = r"^[A-Z0-9]+_[A-Z0-9]+(_[A-Z0-9]+)*$";

/// Mirrors `normalizeSymbol`.
pub fn normalize_symbol(symbol: &str) -> Result<String, OutputError> {
    let mut s = symbol.trim().to_ascii_uppercase().replace(['/', '-'], "_");

    if !s.contains('_') && s.len() >= 3 {
        return Err(OutputError::invalid_symbol(symbol));
    }

    if !s.starts_with("PERP_") {
        s = format!("PERP_{s}");
    }

    let re = regex::Regex::new(SYMBOL_PATTERN).unwrap();
    let tail = &s[5..];
    if !re.is_match(tail) {
        return Err(OutputError::invalid_symbol(symbol));
    }

    Ok(s)
}

pub fn normalize_optional_symbol(symbol: Option<&str>) -> Result<Option<String>, OutputError> {
    match symbol {
        None => Ok(None),
        Some("") => Ok(None),
        Some(s) => Ok(Some(normalize_symbol(s)?)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn unwrap_envelope() {
        assert_eq!(
            unwrap_response(&json!({"success": true, "data": {"a": 1}})),
            json!({"a": 1})
        );
        assert_eq!(
            unwrap_response(&json!({"success": false, "code": 1})),
            json!({"success": false, "code": 1})
        );
        assert_eq!(unwrap_response(&json!({"a": 1})), json!({"a": 1}));
        assert_eq!(unwrap_response(&json!({"data": null})), Value::Null);
    }

    #[test]
    fn csv_object_rows() {
        let data = json!({"rows": [
            {"symbol": "PERP_ETH_USDC", "mark_price": 2124.89},
            {"symbol": "PERP_BTC_USDC", "mark_price": 71551.7}
        ]});
        assert_eq!(
            to_csv(&data),
            "symbol,mark_price\nPERP_ETH_USDC,2124.89\nPERP_BTC_USDC,71551.7"
        );
    }

    #[test]
    fn csv_flat_object() {
        let data = json!({"symbol": "PERP_ETH_USDC", "index_price": 2124.82});
        assert_eq!(to_csv(&data), "symbol,index_price\nPERP_ETH_USDC,2124.82");
    }

    #[test]
    fn csv_empty_array() {
        assert_eq!(to_csv(&json!({"rows": []})), "");
    }

    #[test]
    fn csv_escapes_commas_and_quotes() {
        let data = json!({"rows": [{"note": "a,b", "q": "he said \"hi\""}]});
        assert_eq!(to_csv(&data), "note,q\n\"a,b\",\"he said \"\"hi\"\"\"");
    }

    #[test]
    fn csv_nested_object_and_arrays() {
        let data = json!({"rows": [{"a": {"b": 1}, "list": [{"x": 1}, {"x": 2}]}]});
        assert_eq!(to_csv(&data), "a.b,list.0.x,list.1.x\n1,1,2");
    }

    #[test]
    fn csv_non_object_array_matches_ts() {
        // TS `toCSV` returns "" for a top-level array of scalars (no object rows).
        let data = json!({"rows": [1, 2, 3]});
        assert_eq!(to_csv(&data), "");
    }

    #[test]
    fn extract_rows_prefers_rows_key() {
        assert_eq!(extract_rows(&json!({"rows": [1], "data": [2]})), json!([1]));
        assert_eq!(extract_rows(&json!({"rows": null})), json!([]));
    }

    #[test]
    fn symbol_normalization() {
        assert_eq!(normalize_symbol("eth/usdc").unwrap(), "PERP_ETH_USDC");
        assert_eq!(normalize_symbol("PERP_ETH_USDC").unwrap(), "PERP_ETH_USDC");
        assert_eq!(normalize_symbol("perp-eth-usdc").unwrap(), "PERP_ETH_USDC");
        assert_eq!(normalize_symbol("BTC_USDC").unwrap(), "PERP_BTC_USDC");
        assert!(normalize_symbol("ab").is_err());
        assert!(normalize_symbol("ETHUSDC").is_err());
    }

    #[test]
    fn js_number_formatting() {
        assert_eq!(js_f64_to_string(2124.89), "2124.89");
        assert_eq!(js_f64_to_string(1e21), "1e+21");
        assert_eq!(js_f64_to_string(1e-7), "1e-7");
        assert_eq!(js_f64_to_string(0.0), "0");
    }
}
