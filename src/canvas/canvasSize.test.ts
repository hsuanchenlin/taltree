import { describe, expect, it } from "vitest";
import {
  applyCanvasFillStyle,
  hostContentSize,
  resizeRendererToHost,
} from "./canvasSize";

describe("hostContentSize", () => {
  it("returns the host's CSS box when both axes are positive", () => {
    expect(hostContentSize({ clientWidth: 726, clientHeight: 638 })).toEqual({
      width: 726,
      height: 638,
    });
  });

  it("declines a host that has not been measured yet", () => {
    expect(hostContentSize({ clientWidth: 0, clientHeight: 638 })).toBeNull();
    expect(hostContentSize({ clientWidth: 726, clientHeight: 0 })).toBeNull();
  });
});

describe("applyCanvasFillStyle", () => {
  it("fills the host with 100% CSS width and height", () => {
    const style = { display: "", width: "", height: "" };
    applyCanvasFillStyle(style);
    expect(style).toEqual({
      display: "block",
      width: "100%",
      height: "100%",
    });
  });
});

describe("resizeRendererToHost", () => {
  it("resizes the renderer to the host's CSS box", () => {
    const calls: Array<[number, number]> = [];
    const size = resizeRendererToHost(
      { resize: (width, height) => calls.push([width, height]) },
      { clientWidth: 800, clientHeight: 600 },
    );
    expect(size).toEqual({ width: 800, height: 600 });
    expect(calls).toEqual([[800, 600]]);
  });

  it("does not resize when the host is still 0x0", () => {
    const calls: Array<[number, number]> = [];
    expect(
      resizeRendererToHost(
        { resize: (width, height) => calls.push([width, height]) },
        { clientWidth: 0, clientHeight: 0 },
      ),
    ).toBeNull();
    expect(calls).toEqual([]);
  });
});
