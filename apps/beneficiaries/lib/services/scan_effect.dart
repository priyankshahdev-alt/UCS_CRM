import 'dart:math' as math;
import 'dart:typed_data';

import 'package:image/image.dart' as img;

/// Point in image pixel coordinates.
class DocPoint {
  final double x;
  final double y;
  const DocPoint(this.x, this.y);
}

/// Applies a "scanned document" effect to a captured photo: converts it to
/// grayscale, auto-levels the contrast so the background goes white and the
/// text/ink stays dark, then lightens the white point to look like a real
/// photocopy/scan. Returns a re-encoded JPEG.
Uint8List scanWhiten(Uint8List bytes, {int maxDim = 1600}) {
  img.Image? src;
  try {
    src = img.decodeImage(bytes);
  } catch (_) {
    return bytes;
  }
  if (src == null) return bytes;

  final img.Image work = _resizeMax(src, maxDim);
  final Uint8List out = _whiten(work);
  return out.isEmpty ? bytes : out;
}

/// Full document-scanner pipeline: detects the document's edges in the photo,
/// applies a perspective (homography) correction so it is straight and flat,
/// crops to the document, then whitens it like a real scan.
///
/// If edge detection fails (busy background, low contrast) it degrades
/// gracefully to a plain [scanWhiten] of the whole frame.
Uint8List scanDocument(Uint8List bytes, {int maxDim = 1600}) {
  img.Image? src;
  try {
    src = img.decodeImage(bytes);
  } catch (_) {
    return bytes;
  }
  if (src == null) return bytes;

  final img.Image work = _resizeMax(src, maxDim);

  final List<DocPoint>? corners = _findDocumentCorners(work);
  img.Image result;
  if (corners != null && corners.length == 4) {
    result = _warpToRect(work, corners);
  } else {
    result = work;
  }

  final Uint8List out = _whiten(result);
  return out.isEmpty ? bytes : out;
}

/// Crops [bytes] to the normalized region [norm] then whitens the selection
/// like a real scan. [norm] is `[left, top, right, bottom]` with all values in
/// the 0..1 range (fractions of the image width/height from the top-left).
/// Invalid selections degrade to a plain [scanWhiten] of the whole frame.
Uint8List cropAndWhiten(Uint8List bytes, List<double> norm, {int maxDim = 1600}) {
  img.Image? src;
  try {
    src = img.decodeImage(bytes);
  } catch (_) {
    return bytes;
  }
  if (src == null) return bytes;

  final img.Image work = _resizeMax(src, maxDim);
  img.Image result = work;
  if (norm.length == 4) {
    final double left = norm[0].clamp(0.0, 1.0).toDouble();
    final double top = norm[1].clamp(0.0, 1.0).toDouble();
    final double right = norm[2].clamp(left + 0.01, 1.0).toDouble();
    final double bottom = norm[3].clamp(top + 0.01, 1.0).toDouble();
    final int x = (left * work.width).floor().clamp(0, work.width - 1);
    final int y = (top * work.height).floor().clamp(0, work.height - 1);
    final int w = ((right - left) * work.width).ceil().clamp(1, work.width - x);
    final int h = ((bottom - top) * work.height).ceil().clamp(1, work.height - y);
    try {
      result = img.copyCrop(work, x: x, y: y, width: w, height: h);
    } catch (_) {
      result = work;
    }
  }

  final Uint8List out = _whiten(result);
  return out.isEmpty ? bytes : out;
}

/// Resize so the longest edge is <= [maxDim], preserving aspect ratio.
img.Image _resizeMax(img.Image src, int maxDim) {
  if (src.width <= maxDim && src.height <= maxDim) return src;
  if (src.width >= src.height) {
    return img.copyResize(src,
        width: maxDim, interpolation: img.Interpolation.linear);
  }
  return img.copyResize(src,
      height: maxDim, interpolation: img.Interpolation.linear);
}

/// Grayscale + auto-levels + contrast push → JPEG.
Uint8List _whiten(img.Image input) {
  final gray = img.grayscale(input);
  img.normalize(gray, min: 0, max: 255);
  img.adjustColor(gray, contrast: 1.35, brightness: 1.04, saturation: 0);
  try {
    return Uint8List.fromList(img.encodeJpg(gray, quality: 80));
  } catch (_) {
    return Uint8List(0);
  }
}

/// Detect the four corners of the document.
///
/// Approach (lightweight, no external CV lib):
///  1. Downscale to a small working size so the math is fast.
///  2. Sobel edge map → threshold to a binary edge set.
///  3. Flood-fill the largest connected edge component.
///  4. Take the component's extreme pixels as the four corners.
///
/// Returns null when no confident document region is found.
List<DocPoint>? _findDocumentCorners(img.Image src) {
  const int workW = 420;
  final img.Image work = (src.width >= src.height)
      ? img.copyResize(src, width: workW, interpolation: img.Interpolation.linear)
      : img.copyResize(src,
          height: workW, interpolation: img.Interpolation.linear);

  // Sobel edge magnitude.
  img.Image gray = img.grayscale(img.Image.from(work));
  gray = img.sobel(gray);

  final int w = gray.width;
  final int h = gray.height;

  // Threshold → boolean edge map.
  final Uint8List edge = Uint8List(w * h);
  for (int y = 0; y < h; y++) {
    for (int x = 0; x < w; x++) {
      final lum = gray.getPixel(x, y).r;
      edge[y * w + x] = lum > 70 ? 1 : 0;
    }
  }

  // Dilate once (3x3 OR) to bridge small gaps in the document border.
  final Uint8List dilated = Uint8List(w * h);
  for (int y = 1; y < h - 1; y++) {
    for (int x = 1; x < w - 1; x++) {
      int acc = 0;
      for (int dy = -1; dy <= 1; dy++) {
        int row = (y + dy) * w;
        acc |= edge[row + x - 1] | edge[row + x] | edge[row + x + 1];
      }
      dilated[y * w + x] = acc;
    }
  }

  // Flood fill from every unvisited edge cell; keep the largest component.
  final Uint8List visited = Uint8List(w * h);
  const int marker = 2;
  final List<int> areaStack = <int>[];
  int bestCount = 0;
  int bestIndex = -1;
  for (int i = 0; i < w * h; i++) {
    if (dilated[i] != 1 || visited[i] != 0) continue;
    areaStack.clear();
    areaStack.add(i);
    visited[i] = marker;
    int count = 0;
    while (areaStack.isNotEmpty) {
      final int cur = areaStack.removeLast();
      count++;
      final int cx = cur % w;
      final int cy = cur ~/ w;
      for (int dy = -1; dy <= 1; dy++) {
        final int ny = cy + dy;
        if (ny < 0 || ny >= h) continue;
        for (int dx = -1; dx <= 1; dx++) {
          final int nx = cx + dx;
          if (nx < 0 || nx >= w) continue;
          final int ni = ny * w + nx;
          if (dilated[ni] == 1 && visited[ni] == 0) {
            visited[ni] = marker;
            areaStack.add(ni);
          }
        }
      }
    }
    if (count > bestCount) {
      bestCount = count;
      bestIndex = i;
    }
  }

  // Confident only when the component is a meaningful share of the frame,
  // but not the whole frame (whole frame = no distinct document).
  final double share = bestCount / (w * h);
  if (bestIndex < 0 || share < 0.03 || share > 0.95) return null;

  // Second flood fill to recover the chosen component's pixels and compute
  // the extreme corners (nearest to each image corner).
  final Uint8List comp = Uint8List(w * h);
  final List<int> stack = <int>[bestIndex];
  comp[bestIndex] = 1;
  double bestTL = double.infinity, bestTR = double.infinity;
  double bestBR = double.infinity, bestBL = double.infinity;
  int tl = bestIndex, tr = bestIndex, br = bestIndex, bl = bestIndex;
  while (stack.isNotEmpty) {
    final int cur = stack.removeLast();
    final int cx = cur % w;
    final int cy = cur ~/ w;
    final double distTL = (cx * cx + cy * cy).toDouble();
    final double distTR = ((w - cx) * (w - cx) + cy * cy).toDouble();
    final double distBR = ((w - cx) * (w - cx) + (h - cy) * (h - cy)).toDouble();
    final double distBL = (cx * cx + (h - cy) * (h - cy)).toDouble();
    if (distTL < bestTL) { bestTL = distTL; tl = cur; }
    if (distTR < bestTR) { bestTR = distTR; tr = cur; }
    if (distBR < bestBR) { bestBR = distBR; br = cur; }
    if (distBL < bestBL) { bestBL = distBL; bl = cur; }
    for (int dy = -1; dy <= 1; dy++) {
      final int ny = cy + dy;
      if (ny < 0 || ny >= h) continue;
      for (int dx = -1; dx <= 1; dx++) {
        final int nx = cx + dx;
        if (nx < 0 || nx >= w) continue;
        final int ni = ny * w + nx;
        if (visited[ni] == marker && comp[ni] == 0) {
          comp[ni] = 1;
          stack.add(ni);
        }
      }
    }
  }

  // Scale corner coordinates back to the full-size image.
  final double scaleX = src.width / w;
  final double scaleY = src.height / h;
  return <DocPoint>[
    DocPoint((tl % w) * scaleX, (tl ~/ w) * scaleY),
    DocPoint((tr % w) * scaleX, (tr ~/ w) * scaleY),
    DocPoint((br % w) * scaleX, (br ~/ w) * scaleY),
    DocPoint((bl % w) * scaleX, (bl ~/ w) * scaleY),
  ];
}

/// Warp the source quadrilateral [corners] (TL, TR, BR, BL) onto a
/// rectangular, upright image and return it.
img.Image _warpToRect(img.Image src, List<DocPoint> corners) {
  final double qWidth = _quadWidth(src, corners);
  final double qHeight = _quadHeight(src, corners);
  final int outW = qWidth.round().clamp(200, 3200);
  final int outH = qHeight.round().clamp(200, 3200);

  // Output rectangle corners (TL, TR, BR, BL).
  final List<List<double>> dst = <List<double>>[
    <double>[0, 0],
    <double>[outW - 1, 0],
    <double>[outW - 1, outH - 1],
    <double>[0, outH - 1],
  ];
  final List<List<double>> s = corners
      .map((c) => <double>[c.x, c.y])
      .toList();

  final h = _solveHomography(s, dst);
  if (h == null) return src;

  final img.Image result = img.Image(width: outW, height: outH);
  // Inverse homography maps output pixels → source pixels.
  final hInv = _invert3x3(h);
  if (hInv == null) return src;

  for (int y = 0; y < outH; y++) {
    for (int x = 0; x < outW; x++) {
      final srcPt = _applyHomography(hInv, x.toDouble(), y.toDouble());
      final (num r, num g, num b) = _sampleBilinear(src, srcPt[0], srcPt[1]);
      result.getPixel(x, y).setRgb(r, g, b);
    }
  }
  return result;
}

double _quadWidth(img.Image src, List<DocPoint> c) {
  final l = math.sqrt(math.pow(c[1].x - c[0].x, 2) + math.pow(c[1].y - c[0].y, 2));
  final r = math.sqrt(math.pow(c[2].x - c[3].x, 2) + math.pow(c[2].y - c[3].y, 2));
  return math.max(l, r);
}

double _quadHeight(img.Image src, List<DocPoint> c) {
  final t = math.sqrt(math.pow(c[3].x - c[0].x, 2) + math.pow(c[3].y - c[0].y, 2));
  final b = math.sqrt(math.pow(c[2].x - c[1].x, 2) + math.pow(c[2].y - c[1].y, 2));
  return math.max(t, b);
}

/// Solve a 2D homography (3x3) mapping each source point to its destination
/// point by Gaussian elimination on the standard 8-equation system.
List<List<double>>? _solveHomography(
    List<List<double>> s, List<List<double>> d) {
  const int n = 8;
  final List<List<double>> a = List.generate(n,
      (_) => List<double>.filled(n + 1, 0.0, growable: false));

  for (int i = 0; i < 4; i++) {
    final sx = s[i][0], sy = s[i][1];
    final dx = d[i][0], dy = d[i][1];
    // Row for x:  sx sy 1 0 0 0 -dx*sx -dx*sy = dx
    a[i * 2][0] = sx; a[i * 2][1] = sy; a[i * 2][2] = 1;
    a[i * 2][6] = -dx * sx; a[i * 2][7] = -dx * sy;
    a[i * 2][8] = dx;
    // Row for y:  0 0 0 sx sy 1 -dy*sx -dy*sy = dy
    a[i * 2 + 1][3] = sx; a[i * 2 + 1][4] = sy; a[i * 2 + 1][5] = 1;
    a[i * 2 + 1][6] = -dy * sx; a[i * 2 + 1][7] = -dy * sy;
    a[i * 2 + 1][8] = dy;
  }

  // Forward elimination.
  for (int col = 0; col < n; col++) {
    int pivot = col;
    double maxV = a[col][col].abs();
    for (int r = col + 1; r < n; r++) {
      if (a[r][col].abs() > maxV) {
        maxV = a[r][col].abs();
        pivot = r;
      }
    }
    if (maxV < 1e-12) return null;
    if (pivot != col) {
      final tmp = a[col];
      a[col] = a[pivot];
      a[pivot] = tmp;
    }
    for (int r = col + 1; r < n; r++) {
      final double factor = a[r][col] / a[col][col];
      for (int c = col; c <= n; c++) {
        a[r][c] -= factor * a[col][c];
      }
    }
  }

  // Back substitution.
  final List<double> x = List<double>.filled(n, 0.0);
  for (int r = n - 1; r >= 0; r--) {
    double sum = a[r][n];
    for (int c = r + 1; c < n; c++) {
      sum -= a[r][c] * x[c];
    }
    x[r] = sum / a[r][r];
  }

  return <List<double>>[
    <double>[x[0], x[1], x[2]],
    <double>[x[3], x[4], x[5]],
    <double>[x[6], x[7], 1.0],
  ];
}

List<List<double>>? _invert3x3(List<List<double>> m) {
  final double det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
      m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
      m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  if (det.abs() < 1e-12) return null;
  final double invDet = 1.0 / det;
  return <List<double>>[
    <double>[
      (m[1][1] * m[2][2] - m[1][2] * m[2][1]) * invDet,
      (m[0][2] * m[2][1] - m[0][1] * m[2][2]) * invDet,
      (m[0][1] * m[1][2] - m[0][2] * m[1][1]) * invDet,
    ],
    <double>[
      (m[1][2] * m[2][0] - m[1][0] * m[2][2]) * invDet,
      (m[0][0] * m[2][2] - m[0][2] * m[2][0]) * invDet,
      (m[0][2] * m[1][0] - m[0][0] * m[1][2]) * invDet,
    ],
    <double>[
      (m[1][0] * m[2][1] - m[1][1] * m[2][0]) * invDet,
      (m[0][1] * m[2][0] - m[0][0] * m[2][1]) * invDet,
      (m[0][0] * m[1][1] - m[0][1] * m[1][0]) * invDet,
    ],
  ];
}

List<double> _applyHomography(List<List<double>> h, double x, double y) {
  final double wInv = 1.0 / (h[2][0] * x + h[2][1] * y + h[2][2]);
  return <double>[
    (h[0][0] * x + h[0][1] * y + h[0][2]) * wInv,
    (h[1][0] * x + h[1][1] * y + h[1][2]) * wInv,
  ];
}

/// Bilinear sample of [src] at fractional [sx], [sy]. Returns (r, g, b).
(num, num, num) _sampleBilinear(img.Image src, double sx, double sy) {
  final int w = src.width;
  final int h = src.height;
  final double x = sx.floorToDouble();
  final double y = sy.floorToDouble();
  final double fx = sx - x;
  final double fy = sy - y;
  final int x0 = x.clamp(0, w - 1).toInt();
  final int y0 = y.clamp(0, h - 1).toInt();
  final int x1 = x0 < w - 1 ? x0 + 1 : x0;
  final int y1 = y0 < h - 1 ? y0 + 1 : y0;

  final img.Pixel p00 = src.getPixel(x0, y0);
  final img.Pixel p10 = src.getPixel(x1, y0);
  final img.Pixel p01 = src.getPixel(x0, y1);
  final img.Pixel p11 = src.getPixel(x1, y1);

  final double r = _blend(
      p00.r.toDouble(), p10.r.toDouble(), p01.r.toDouble(), p11.r.toDouble(), fx, fy);
  final double g = _blend(
      p00.g.toDouble(), p10.g.toDouble(), p01.g.toDouble(), p11.g.toDouble(), fx, fy);
  final double b = _blend(
      p00.b.toDouble(), p10.b.toDouble(), p01.b.toDouble(), p11.b.toDouble(), fx, fy);

  return (r.round().clamp(0, 255), g.round().clamp(0, 255), b.round().clamp(0, 255));
}

double _blend(double p00, double p10, double p01, double p11, double fx, double fy) {
  final double top = p00 + (p10 - p00) * fx;
  final double bottom = p01 + (p11 - p01) * fx;
  return top + (bottom - top) * fy;
}