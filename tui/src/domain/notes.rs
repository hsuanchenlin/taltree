//! Typed resource links living inside a node's free-text notes.
//!
//! There is no schema field for these. A list line of the form
//! `- [@article@The Internet](https://en.wikipedia.org/wiki/Internet)` is
//! shown as a type tag and a title link. Unknown types stay in the notes body.

/// The types a notes line may name.
pub const RESOURCE_TYPES: [&str; 8] = [
    "official",
    "opensource",
    "article",
    "course",
    "podcast",
    "video",
    "book",
    "feed",
];

/// One typed resource extracted from a notes line.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResourceLink {
    pub kind: ResourceType,
    pub title: String,
    pub url: String,
}

/// The eight types a notes line may name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResourceType {
    Official,
    Opensource,
    Article,
    Course,
    Podcast,
    Video,
    Book,
    Feed,
}

impl ResourceType {
    pub fn parse(token: &str) -> Option<Self> {
        Some(match token {
            "official" => Self::Official,
            "opensource" => Self::Opensource,
            "article" => Self::Article,
            "course" => Self::Course,
            "podcast" => Self::Podcast,
            "video" => Self::Video,
            "book" => Self::Book,
            "feed" => Self::Feed,
            _ => return None,
        })
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Official => "official",
            Self::Opensource => "opensource",
            Self::Article => "article",
            Self::Course => "course",
            Self::Podcast => "podcast",
            Self::Video => "video",
            Self::Book => "book",
            Self::Feed => "feed",
        }
    }
}

/// Notes split into remaining prose and any typed resource links.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ParsedNotes {
    pub body: String,
    pub links: Vec<ResourceLink>,
}

/// Read typed resource links out of a notes field. The original string is not
/// rewritten; this is display-only.
pub fn parse_notes(notes: &str) -> ParsedNotes {
    let mut links = Vec::new();
    let mut body_lines: Vec<&str> = Vec::new();
    for line in notes.lines() {
        if let Some(link) = parse_resource_line(line) {
            links.push(link);
        } else {
            body_lines.push(line);
        }
    }
    ParsedNotes {
        body: trim_blank_lines(&body_lines),
        links,
    }
}

pub fn parse_optional_notes(notes: Option<&str>) -> ParsedNotes {
    match notes {
        Some(text) => parse_notes(text),
        None => ParsedNotes::default(),
    }
}

/// A list line: `- [@article@The Internet](https://en.wikipedia.org/wiki/Internet)`.
pub fn parse_resource_line(line: &str) -> Option<ResourceLink> {
    let rest = line.trim().strip_prefix('-')?.trim_start();
    let rest = rest.strip_prefix('[')?;
    let rest = rest.strip_prefix('@')?;
    let at = rest.find('@')?;
    let kind = ResourceType::parse(&rest[..at])?;
    let rest = &rest[at + 1..];
    let close = rest.find(']')?;
    let title = rest[..close].trim();
    if title.is_empty() {
        return None;
    }
    let rest = rest[close + 1..].trim_start();
    let rest = rest.strip_prefix('(')?;
    let end = rest.find(')')?;
    if !rest[end + 1..].trim().is_empty() {
        return None;
    }
    let url = rest[..end].trim();
    if !is_http_url(url) {
        return None;
    }
    Some(ResourceLink {
        kind,
        title: title.to_string(),
        url: url.to_string(),
    })
}

fn is_http_url(url: &str) -> bool {
    let rest = if let Some(rest) = strip_prefix_ignore_ascii_case(url, "https://") {
        rest
    } else if let Some(rest) = strip_prefix_ignore_ascii_case(url, "http://") {
        rest
    } else {
        return false;
    };
    rest.chars().next().is_some_and(|c| !c.is_whitespace())
}

fn strip_prefix_ignore_ascii_case<'a>(value: &'a str, prefix: &str) -> Option<&'a str> {
    if value.len() >= prefix.len()
        && value.as_bytes()[..prefix.len()].eq_ignore_ascii_case(prefix.as_bytes())
    {
        Some(&value[prefix.len()..])
    } else {
        None
    }
}

fn trim_blank_lines(lines: &[&str]) -> String {
    let start = lines
        .iter()
        .position(|line| !line.trim().is_empty())
        .unwrap_or(lines.len());
    let end = lines
        .iter()
        .rposition(|line| !line.trim().is_empty())
        .map(|index| index + 1)
        .unwrap_or(0);
    if start >= end {
        return String::new();
    }
    lines[start..end].join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    const INTERNET: &str = "- [@article@The Internet](https://en.wikipedia.org/wiki/Internet)";

    #[test]
    fn a_typed_markdown_list_line_becomes_a_tag_and_a_title_link() {
        let link = parse_resource_line(INTERNET).expect("link");
        assert_eq!(link.kind, ResourceType::Article);
        assert_eq!(link.title, "The Internet");
        assert_eq!(link.url, "https://en.wikipedia.org/wiki/Internet");
    }

    #[test]
    fn every_documented_type_is_accepted() {
        for token in RESOURCE_TYPES {
            let line = format!("- [@{token}@Example](https://example.com/{token})");
            let link = parse_resource_line(&line).expect(token);
            assert_eq!(link.kind.as_str(), token);
        }
    }

    #[test]
    fn unknown_types_and_non_http_urls_stay_in_the_notes_body() {
        let notes = format!(
            "Read this first.\n\
             - [@blog@Not a type](https://example.com/blog)\n\
             - a plain bullet\n\
             - [@article@Scripted](javascript:alert(1))\n\
             {INTERNET}\n\
             \n\
             Then write a summary."
        );
        let parsed = parse_notes(&notes);
        assert_eq!(
            parsed.body,
            "Read this first.\n\
             - [@blog@Not a type](https://example.com/blog)\n\
             - a plain bullet\n\
             - [@article@Scripted](javascript:alert(1))\n\
             \n\
             Then write a summary."
        );
        assert_eq!(parsed.links.len(), 1);
        assert_eq!(parsed.links[0].title, "The Internet");
    }

    #[test]
    fn surrounding_blank_lines_are_trimmed_from_the_body() {
        let parsed = parse_notes(&format!("\n{INTERNET}\n\nKeep this.\n"));
        assert_eq!(parsed.body, "Keep this.");
        assert_eq!(parsed.links.len(), 1);
    }

    #[test]
    fn missing_notes_parse_as_empty() {
        assert_eq!(parse_optional_notes(None), ParsedNotes::default());
        assert_eq!(parse_notes(""), ParsedNotes::default());
    }
}
