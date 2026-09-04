import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;
import 'package:flutter/painting.dart' as p;
import 'package:image/image.dart' as img;

class SelfieStamp {
  static Future<File?> apply({
    required File source,
    required String dateTime,
    required String place,
    required String coordinates,
  }) async {
    try {
      final bytes = await source.readAsBytes();
      img.Image? image = img.decodeImage(bytes);
      if (image == null) return null;

      final width = image.width;
      final height = image.height;
      final fontSize = width * 0.028;

      final addressPainter = p.TextPainter(
        maxLines: 2,
        ellipsis: '...',
        textDirection: p.TextDirection.ltr,
        text: p.TextSpan(
          text: place,
          style: p.TextStyle(
            color: p.Color(0xFFFFFFFF),
            fontSize: fontSize,
            fontWeight: p.FontWeight.w500,
          ),
        ),
      )..layout(maxWidth: width * 0.96);

      final bottomPainter = p.TextPainter(
        textDirection: p.TextDirection.ltr,
        text: p.TextSpan(
          text: '$dateTime  |  $coordinates',
          style: p.TextStyle(
            color: p.Color(0xFFBBBBBB),
            fontSize: fontSize * 0.85,
          ),
        ),
      )..layout(maxWidth: width * 0.96);

      final barH = (addressPainter.height + bottomPainter.height + 16).toInt();

      final recorder = ui.PictureRecorder();
      final canvas = ui.Canvas(recorder);
      canvas.drawRect(
        ui.Rect.fromLTWH(0, 0, width.toDouble(), barH.toDouble()),
        ui.Paint()..color = const ui.Color(0xBB000000),
      );

      addressPainter.paint(canvas, p.Offset(width * 0.02, 6));
      bottomPainter.paint(canvas, p.Offset(width * 0.02, addressPainter.height + 10));

      final picture = recorder.endRecording();
      final uiImage = await picture.toImage(width, barH);
      final byteData = await uiImage.toByteData(format: ui.ImageByteFormat.rawRgba);
      if (byteData == null) return null;

      final overlayImg = img.Image.fromBytes(
        width: width,
        height: barH,
        bytes: byteData.buffer,
        numChannels: 4,
      );

      final canvasImg = img.Image(width: width, height: height + barH);
      img.compositeImage(canvasImg, image, dstX: 0, dstY: 0);
      img.compositeImage(canvasImg, overlayImg, dstX: 0, dstY: height);

      final stampedBytes = img.encodeJpg(canvasImg, quality: 92);
      final stamped = File(
        '${source.path.substring(0, source.path.lastIndexOf('.'))}_stamped.jpg',
      );
      await stamped.writeAsBytes(Uint8List.fromList(stampedBytes));
      return stamped;
    } catch (_) {
      return null;
    }
  }
}