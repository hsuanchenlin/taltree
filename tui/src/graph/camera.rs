//! Which part of the board the viewport is looking at.
//!
//! Every camera write goes through [`clamp`], so no pan, jump, or terminal
//! resize can park the whole tree outside the visible area.

use super::layout::PlacedNode;

/// The top-left board cell shown in the viewport.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Camera {
    pub x: u16,
    pub y: u16,
}

/// The size of the area the board is drawn into, in cells.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Viewport {
    pub width: u16,
    pub height: u16,
}

impl Viewport {
    pub fn new(width: u16, height: u16) -> Self {
        Viewport { width, height }
    }
}

/// The board area a node covers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
}

impl From<&PlacedNode> for Rect {
    fn from(node: &PlacedNode) -> Self {
        Rect {
            x: node.x,
            y: node.y,
            width: node.width,
            height: node.height,
        }
    }
}

/// The size of the whole board.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BoardSize {
    pub width: u16,
    pub height: u16,
}

/// Pull a camera back onto the board.
///
/// A board smaller than the viewport is shown from its top-left corner rather
/// than floating somewhere in the middle of the empty space.
pub fn clamp(camera: Camera, board: BoardSize, view: Viewport) -> Camera {
    Camera {
        x: camera.x.min(board.width.saturating_sub(view.width)),
        y: camera.y.min(board.height.saturating_sub(view.height)),
    }
}

/// Move the camera by a signed number of cells.
pub fn pan(camera: Camera, dx: i32, dy: i32, board: BoardSize, view: Viewport) -> Camera {
    let moved = Camera {
        x: shift(camera.x, dx),
        y: shift(camera.y, dy),
    };
    clamp(moved, board, view)
}

/// The smallest camera move that brings `rect` fully into view.
///
/// A node wider or taller than the viewport is aligned to its top-left corner,
/// which is where its socket and title are.
pub fn keep_visible(camera: Camera, rect: Rect, board: BoardSize, view: Viewport) -> Camera {
    let mut x = camera.x;
    let mut y = camera.y;

    if rect.x < x {
        x = rect.x;
    } else if view.width > 0 && rect.x + rect.width > x + view.width {
        x = (rect.x + rect.width).saturating_sub(view.width).min(rect.x);
    }
    if rect.y < y {
        y = rect.y;
    } else if view.height > 0 && rect.y + rect.height > y + view.height {
        y = (rect.y + rect.height)
            .saturating_sub(view.height)
            .min(rect.y);
    }

    clamp(Camera { x, y }, board, view)
}

/// Put `rect` in the middle of the viewport.
pub fn center_on(rect: Rect, board: BoardSize, view: Viewport) -> Camera {
    let x = center(rect.x, rect.width, view.width);
    let y = center(rect.y, rect.height, view.height);
    clamp(Camera { x, y }, board, view)
}

fn center(start: u16, size: u16, view: u16) -> u16 {
    let middle = start as i32 + size as i32 / 2;
    shift_i32(middle - view as i32 / 2)
}

fn shift(value: u16, delta: i32) -> u16 {
    shift_i32(value as i32 + delta)
}

fn shift_i32(value: i32) -> u16 {
    value.clamp(0, u16::MAX as i32) as u16
}

#[cfg(test)]
mod tests {
    use super::*;

    const BOARD: BoardSize = BoardSize {
        width: 100,
        height: 40,
    };
    const VIEW: Viewport = Viewport {
        width: 30,
        height: 10,
    };

    #[test]
    fn a_camera_inside_the_board_is_left_alone() {
        let camera = Camera { x: 10, y: 5 };
        assert_eq!(clamp(camera, BOARD, VIEW), camera);
    }

    #[test]
    fn a_camera_past_the_edge_is_pulled_back_to_show_the_last_cells() {
        assert_eq!(
            clamp(Camera { x: 500, y: 500 }, BOARD, VIEW),
            Camera { x: 70, y: 30 }
        );
    }

    #[test]
    fn a_board_smaller_than_the_viewport_is_shown_from_its_corner() {
        let small = BoardSize {
            width: 10,
            height: 4,
        };
        assert_eq!(
            clamp(Camera { x: 9, y: 3 }, small, VIEW),
            Camera { x: 0, y: 0 }
        );
    }

    #[test]
    fn panning_never_walks_off_the_board() {
        assert_eq!(
            pan(Camera { x: 0, y: 0 }, -5, -5, BOARD, VIEW),
            Camera { x: 0, y: 0 }
        );
        assert_eq!(
            pan(Camera { x: 0, y: 0 }, 500, 500, BOARD, VIEW),
            Camera { x: 70, y: 30 }
        );
    }

    #[test]
    fn a_node_already_in_view_does_not_move_the_camera() {
        let camera = Camera { x: 10, y: 5 };
        let rect = Rect {
            x: 12,
            y: 6,
            width: 10,
            height: 1,
        };
        assert_eq!(keep_visible(camera, rect, BOARD, VIEW), camera);
    }

    #[test]
    fn a_node_below_the_viewport_scrolls_just_far_enough() {
        let camera = Camera { x: 0, y: 0 };
        let rect = Rect {
            x: 0,
            y: 12,
            width: 10,
            height: 3,
        };
        assert_eq!(
            keep_visible(camera, rect, BOARD, VIEW),
            Camera { x: 0, y: 5 }
        );
    }

    #[test]
    fn a_node_above_the_viewport_scrolls_back_up_to_it() {
        let camera = Camera { x: 0, y: 20 };
        let rect = Rect {
            x: 0,
            y: 3,
            width: 10,
            height: 1,
        };
        assert_eq!(
            keep_visible(camera, rect, BOARD, VIEW),
            Camera { x: 0, y: 3 }
        );
    }

    #[test]
    fn a_node_wider_than_the_viewport_is_aligned_to_its_left_edge() {
        let narrow = Viewport {
            width: 12,
            height: 10,
        };
        let rect = Rect {
            x: 40,
            y: 0,
            width: 24,
            height: 1,
        };
        assert_eq!(
            keep_visible(Camera::default(), rect, BOARD, narrow),
            Camera { x: 40, y: 0 }
        );
    }

    #[test]
    fn centring_puts_the_node_in_the_middle_of_the_viewport() {
        let rect = Rect {
            x: 50,
            y: 20,
            width: 24,
            height: 1,
        };
        assert_eq!(center_on(rect, BOARD, VIEW), Camera { x: 47, y: 15 });
    }

    #[test]
    fn centring_a_node_near_the_corner_stays_on_the_board() {
        let rect = Rect {
            x: 0,
            y: 0,
            width: 24,
            height: 1,
        };
        assert_eq!(center_on(rect, BOARD, VIEW), Camera { x: 0, y: 0 });
    }
}
