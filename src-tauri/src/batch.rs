//! Batch URL parser and generator for pattern expansion.
//! Examples:
//! - "https://site.com/file[001-100].jpg" -> 100 URLs with zero padding
//! - "https://site.com/part_[a-z].zip" -> part_a.zip to part_z.zip
//! - Multiline pasted URLs

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchExpandResult {
    pub urls: Vec<String>,
    pub total: usize,
}

/// Expand a string which may contain multiple URLs (separated by newlines)
/// or pattern expressions like `[001-100]` or `[a-z]`.
pub fn expand_batch(input: &str) -> BatchExpandResult {
    let mut results = Vec::new();

    for line in input.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let expanded = expand_pattern(trimmed);
        for u in expanded {
            if !results.contains(&u) {
                results.push(u);
            }
        }
    }

    let total = results.len();
    BatchExpandResult { urls: results, total }
}

/// Expand a single line if it contains a `[start-end]` pattern.
fn expand_pattern(line: &str) -> Vec<String> {
    if let (Some(open), Some(close)) = (line.find('['), line.find(']')) {
        if open < close {
            let prefix = &line[..open];
            let pattern = &line[open + 1..close];
            let suffix = &line[close + 1..];

            // Check numeric pattern: e.g. "001-100" or "1-50"
            if let Some((start_str, end_str)) = pattern.split_once('-') {
                let start_str = start_str.trim();
                let end_str = end_str.trim();

                // Numeric range
                if let (Ok(start), Ok(end)) = (start_str.parse::<u64>(), end_str.parse::<u64>()) {
                    let pad_len = if start_str.starts_with('0') {
                        start_str.len()
                    } else {
                        0
                    };

                    let mut out = Vec::new();
                    let step = if start <= end { 1 } else { -1 };
                    let mut cur = start as i64;
                    let target = end as i64;

                    while (step > 0 && cur <= target) || (step < 0 && cur >= target) {
                        let num_formatted = if pad_len > 0 {
                            format!("{:0width$}", cur, width = pad_len)
                        } else {
                            format!("{}", cur)
                        };
                        let expanded_line = format!("{prefix}{num_formatted}{suffix}");
                        // Recursively expand any subsequent patterns
                        out.extend(expand_pattern(&expanded_line));
                        cur += step;
                        if out.len() >= 10000 {
                            break; // safety limit
                        }
                    }
                    return out;
                }

                // Alphabetic range: e.g. "a-z" or "A-Z"
                if start_str.len() == 1 && end_str.len() == 1 {
                    let start_char = start_str.chars().next().unwrap();
                    let end_char = end_str.chars().next().unwrap();
                    if start_char.is_ascii_alphabetic() && end_char.is_ascii_alphabetic() {
                        let mut out = Vec::new();
                        let start_u = start_char as u8;
                        let end_u = end_char as u8;
                        if start_u <= end_u {
                            for c in start_u..=end_u {
                                let expanded_line = format!("{prefix}{}{suffix}", c as char);
                                out.extend(expand_pattern(&expanded_line));
                            }
                        }
                        return out;
                    }
                }
            }
        }
    }

    vec![line.to_string()]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_expand_numeric_padding() {
        let res = expand_batch("http://example.com/file[001-005].jpg");
        assert_eq!(res.total, 5);
        assert_eq!(res.urls[0], "http://example.com/file001.jpg");
        assert_eq!(res.urls[4], "http://example.com/file005.jpg");
    }

    #[test]
    fn test_expand_alpha() {
        let res = expand_batch("http://example.com/img_[a-c].png");
        assert_eq!(res.total, 3);
        assert_eq!(res.urls[0], "http://example.com/img_a.png");
        assert_eq!(res.urls[2], "http://example.com/img_c.png");
    }

    #[test]
    fn test_multiline() {
        let input = "http://a.com/1.zip\nhttp://b.com/2.zip\n";
        let res = expand_batch(input);
        assert_eq!(res.total, 2);
    }
}
