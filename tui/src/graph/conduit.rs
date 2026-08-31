//! Turning conduit runs into box-drawing glyphs.
//!
//! Each cell remembers which way its conduit leaves it - north, south, east,
//! west - and only at the end does a cell become a character. That is what lets
//! two prerequisites arriving at one dependent merge into a `┬` instead of one
//! overwriting the other.
//!
//! A conduit whose prerequisite is completed is drawn illuminated, in the
//! double-line set (`═ ║ ╔ ╣ ╬`), so a finished branch reads as live at a glance.

pub const NORTH: u8 = 1;
pub const SOUTH: u8 = 2;
pub const EAST: u8 = 4;
pub const WEST: u8 = 8;

/// The conduit layer of a board: direction bits per cell, baked into glyphs last.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Conduits {
    width: u16,
    height: u16,
    bits: Vec<u8>,
    illuminated: Vec<bool>,
}

impl Conduits {
    pub fn new(width: u16, height: u16) -> Self {
        let area = width as usize * height as usize;
        Conduits {
            width,
            height,
            bits: vec![0; area],
            illuminated: vec![false; area],
        }
    }

    pub fn width(&self) -> u16 {
        self.width
    }

    pub fn height(&self) -> u16 {
        self.height
    }

    /// Draw one conduit along its waypoints.
    ///
    /// The first cell also reaches north and the last also reaches south,
    /// because those ends butt against the nodes the conduit joins.
    pub fn draw(&mut self, points: &[(u16, u16)], illuminated: bool) {
        let Some(&first) = points.first() else {
            return;
        };
        let Some(&last) = points.last() else {
            return;
        };
        for pair in points.windows(2) {
            self.run(pair[0], pair[1], illuminated);
        }
        self.add(first, NORTH, illuminated);
        self.add(last, SOUTH, illuminated);
    }

    /// The character this cell has become, if a conduit passes through it.
    pub fn glyph_at(&self, x: u16, y: u16) -> Option<char> {
        let bits = self.bits_at(x, y);
        glyph(bits, self.is_illuminated(x, y))
    }

    pub fn bits_at(&self, x: u16, y: u16) -> u8 {
        self.index(x, y).map(|index| self.bits[index]).unwrap_or(0)
    }

    pub fn is_illuminated(&self, x: u16, y: u16) -> bool {
        self.index(x, y)
            .map(|index| self.illuminated[index])
            .unwrap_or(false)
    }

    /// The whole layer as text, for tests and for eyeballing a layout.
    pub fn to_lines(&self) -> Vec<String> {
        (0..self.height)
            .map(|y| {
                (0..self.width)
                    .map(|x| self.glyph_at(x, y).unwrap_or(' '))
                    .collect()
            })
            .collect()
    }

    fn run(&mut self, from: (u16, u16), to: (u16, u16), illuminated: bool) {
        if from.0 == to.0 {
            let (top, bottom) = order(from.1, to.1);
            for y in top..=bottom {
                let mut bits = 0;
                if y > top {
                    bits |= NORTH;
                }
                if y < bottom {
                    bits |= SOUTH;
                }
                self.add((from.0, y), bits, illuminated);
            }
        } else if from.1 == to.1 {
            let (left, right) = order(from.0, to.0);
            for x in left..=right {
                let mut bits = 0;
                if x > left {
                    bits |= WEST;
                }
                if x < right {
                    bits |= EAST;
                }
                self.add((x, from.1), bits, illuminated);
            }
        }
        // Waypoints always share a row or a column, so a diagonal pair can only
        // come from a corrupt route; drawing nothing beats drawing a smear.
    }

    fn add(&mut self, at: (u16, u16), bits: u8, illuminated: bool) {
        let Some(index) = self.index(at.0, at.1) else {
            return;
        };
        self.bits[index] |= bits;
        if illuminated {
            self.illuminated[index] = true;
        }
    }

    fn index(&self, x: u16, y: u16) -> Option<usize> {
        if x >= self.width || y >= self.height {
            return None;
        }
        Some(y as usize * self.width as usize + x as usize)
    }
}

fn order(a: u16, b: u16) -> (u16, u16) {
    if a <= b {
        (a, b)
    } else {
        (b, a)
    }
}

/// The box-drawing character for a set of directions.
pub fn glyph(bits: u8, illuminated: bool) -> Option<char> {
    let single = match bits {
        0 => return None,
        b if b == NORTH || b == SOUTH || b == NORTH | SOUTH => '│',
        b if b == EAST || b == WEST || b == EAST | WEST => '─',
        b if b == SOUTH | EAST => '┌',
        b if b == SOUTH | WEST => '┐',
        b if b == NORTH | EAST => '└',
        b if b == NORTH | WEST => '┘',
        b if b == NORTH | SOUTH | EAST => '├',
        b if b == NORTH | SOUTH | WEST => '┤',
        b if b == SOUTH | EAST | WEST => '┬',
        b if b == NORTH | EAST | WEST => '┴',
        _ => '┼',
    };
    if !illuminated {
        return Some(single);
    }
    Some(match single {
        '│' => '║',
        '─' => '═',
        '┌' => '╔',
        '┐' => '╗',
        '└' => '╚',
        '┘' => '╝',
        '├' => '╠',
        '┤' => '╣',
        '┬' => '╦',
        '┴' => '╩',
        _ => '╬',
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rendered(conduits: &Conduits) -> String {
        conduits.to_lines().join("\n")
    }

    #[test]
    fn every_direction_set_has_a_glyph() {
        assert_eq!(glyph(0, false), None);
        assert_eq!(glyph(NORTH | SOUTH, false), Some('│'));
        assert_eq!(glyph(EAST | WEST, false), Some('─'));
        assert_eq!(glyph(SOUTH | EAST, false), Some('┌'));
        assert_eq!(glyph(SOUTH | WEST, false), Some('┐'));
        assert_eq!(glyph(NORTH | EAST, false), Some('└'));
        assert_eq!(glyph(NORTH | WEST, false), Some('┘'));
        assert_eq!(glyph(NORTH | SOUTH | EAST, false), Some('├'));
        assert_eq!(glyph(NORTH | SOUTH | WEST, false), Some('┤'));
        assert_eq!(glyph(SOUTH | EAST | WEST, false), Some('┬'));
        assert_eq!(glyph(NORTH | EAST | WEST, false), Some('┴'));
        assert_eq!(glyph(NORTH | SOUTH | EAST | WEST, false), Some('┼'));
    }

    #[test]
    fn an_illuminated_conduit_uses_the_double_line_set() {
        assert_eq!(glyph(NORTH | SOUTH, true), Some('║'));
        assert_eq!(glyph(EAST | WEST, true), Some('═'));
        assert_eq!(glyph(SOUTH | EAST, true), Some('╔'));
        assert_eq!(glyph(NORTH | SOUTH | EAST | WEST, true), Some('╬'));
    }

    #[test]
    fn a_straight_drop_is_one_column_of_pipe() {
        let mut conduits = Conduits::new(3, 4);
        conduits.draw(&[(1, 1), (1, 2)], false);
        assert_eq!(rendered(&conduits), "   \n │ \n │ \n   ");
    }

    #[test]
    fn a_sideways_conduit_turns_a_corner() {
        let mut conduits = Conduits::new(6, 3);
        conduits.draw(&[(1, 0), (1, 1), (4, 1)], false);
        assert_eq!(rendered(&conduits), " │    \n └──┐ \n      ");
    }

    #[test]
    fn two_conduits_into_one_dependent_merge_into_a_tee() {
        let mut conduits = Conduits::new(9, 3);
        // A parent to the left and a parent to the right, both arriving at x=4.
        conduits.draw(&[(1, 0), (1, 1), (4, 1)], false);
        conduits.draw(&[(7, 0), (7, 1), (4, 1)], false);
        assert_eq!(rendered(&conduits), " │     │ \n └──┬──┘ \n         ");
    }

    #[test]
    fn one_prerequisite_feeding_two_dependents_forks() {
        let mut conduits = Conduits::new(9, 3);
        conduits.draw(&[(4, 0), (4, 1), (1, 1)], false);
        conduits.draw(&[(4, 0), (4, 1), (7, 1)], false);
        assert_eq!(rendered(&conduits), "    │    \n ┌──┴──┐ \n         ");
    }

    #[test]
    fn a_conduit_crossing_a_channel_becomes_a_cross() {
        let mut conduits = Conduits::new(5, 4);
        conduits.draw(&[(2, 0), (2, 3)], false);
        conduits.draw(&[(0, 1), (0, 1), (4, 1)], false);
        assert_eq!(conduits.glyph_at(2, 1), Some('┼'));
    }

    #[test]
    fn illumination_spreads_to_every_cell_the_conduit_touches() {
        let mut conduits = Conduits::new(6, 3);
        conduits.draw(&[(1, 0), (1, 1), (4, 1)], true);
        assert_eq!(rendered(&conduits), " ║    \n ╚══╗ \n      ");
    }

    #[test]
    fn a_lit_conduit_wins_the_cell_it_shares_with_a_dark_one() {
        let mut conduits = Conduits::new(9, 3);
        conduits.draw(&[(1, 0), (1, 1), (4, 1)], false);
        conduits.draw(&[(7, 0), (7, 1), (4, 1)], true);
        assert_eq!(conduits.glyph_at(4, 1), Some('╦'));
    }

    #[test]
    fn drawing_outside_the_board_is_ignored_rather_than_panicking() {
        let mut conduits = Conduits::new(3, 3);
        conduits.draw(&[(10, 10), (10, 20)], false);
        assert_eq!(rendered(&conduits), "   \n   \n   ");
    }

    #[test]
    fn an_empty_route_draws_nothing() {
        let mut conduits = Conduits::new(2, 2);
        conduits.draw(&[], false);
        assert_eq!(rendered(&conduits), "  \n  ");
    }
}
