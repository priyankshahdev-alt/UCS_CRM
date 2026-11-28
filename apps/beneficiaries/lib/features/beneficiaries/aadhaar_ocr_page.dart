import 'dart:io';

import 'package:flutter/material.dart';
import 'package:google_mlkit_text_recognition/google_mlkit_text_recognition.dart';
import 'package:image_picker/image_picker.dart';
import 'dart:convert';

class AadhaarOcrPage extends StatefulWidget {
  const AadhaarOcrPage({super.key});

  @override
  State<AadhaarOcrPage> createState() => _AadhaarOcrPageState();
}

class _AadhaarOcrPageState extends State<AadhaarOcrPage> {
  final ImagePicker _picker = ImagePicker();

  final TextEditingController _nameController = TextEditingController();
  final TextEditingController _dobController = TextEditingController();
  final TextEditingController _aadhaarController =
      TextEditingController();
  final TextEditingController _addressController =
      TextEditingController();

  File? _frontImage;
  File? _backImage;

  String _gender = '';

  bool _processingFront = false;
  bool _processingBack = false;

  String _frontMessage = '';
  String _backMessage = '';

  // ------------------------------------------------------------
  // IMAGE PICK
  // ------------------------------------------------------------

  Future<void> _pickFront(ImageSource source) async {
    try {
      final XFile? file = await _picker.pickImage(
        source: source,
        imageQuality: 100,
      );

      if (file == null) return;

      setState(() {
        _frontImage = File(file.path);
        _processingFront = true;
        _frontMessage = 'Reading Aadhaar front side...';
      });

      await _processFront(file.path);
    } catch (_) {
      if (!mounted) return;

      setState(() {
        _processingFront = false;
        _frontMessage = 'Unable to process front image.';
      });
    }
  }

  Future<void> _pickBack(ImageSource source) async {
    try {
      final XFile? file = await _picker.pickImage(
        source: source,
        imageQuality: 100,
      );

      if (file == null) return;

      setState(() {
        _backImage = File(file.path);
        _processingBack = true;
        _backMessage = 'Reading Aadhaar back side...';
      });

      await _processBack(file.path);
    } catch (_) {
      if (!mounted) return;

      setState(() {
        _processingBack = false;
        _backMessage = 'Unable to process back image.';
      });
    }
  }

  // ------------------------------------------------------------
  // FRONT OCR
  // ------------------------------------------------------------

  Future<void> _processFront(String path) async {
    final recognizer = TextRecognizer(
      script: TextRecognitionScript.latin,
    );

    try {
      final inputImage = InputImage.fromFilePath(path);

      final RecognizedText result =
          await recognizer.processImage(inputImage);

      final text = result.text;

      final aadhaar = _extractAadhaar(text);
      final dob = _extractDob(text);
      final gender = _extractGender(text);
      final name = _extractName(text);

      if (!mounted) return;

      setState(() {
        _processingFront = false;

        if (name != null && name.isNotEmpty) {
          _nameController.text = name;
        }

        if (dob != null && dob.isNotEmpty) {
          _dobController.text = dob;
        }

        if (gender != null && gender.isNotEmpty) {
          _gender = gender;
        }

        if (aadhaar != null) {
          _aadhaarController.text = _formatAadhaar(aadhaar);
        }

        _frontMessage =
            'Front side scanned. Please verify the detected details.';
      });
    } catch (_) {
      if (!mounted) return;

      setState(() {
        _processingFront = false;
        _frontMessage =
            'OCR failed. Please use a clearer front image.';
      });
    } finally {
      await recognizer.close();
    }
  }

  // ------------------------------------------------------------
  // BACK OCR
  // ------------------------------------------------------------

  Future<void> _processBack(String path) async {
    final recognizer = TextRecognizer(
      script: TextRecognitionScript.latin,
    );

    try {
      final inputImage = InputImage.fromFilePath(path);

      final RecognizedText result =
          await recognizer.processImage(inputImage);

      final text = result.text;

      final address = _extractAddress(text);

      if (!mounted) return;

      setState(() {
        _processingBack = false;

        if (address != null && address.isNotEmpty) {
          _addressController.text = address;
        }

        _backMessage =
            'Back side scanned. Please verify the address.';
      });
    } catch (_) {
      if (!mounted) return;

      setState(() {
        _processingBack = false;
        _backMessage =
            'OCR failed. Please use a clearer back image.';
      });
    } finally {
      await recognizer.close();
    }
  }

  // ------------------------------------------------------------
  // AADHAAR NUMBER
  // ------------------------------------------------------------

  String? _extractAadhaar(String text) {
    final formatted = RegExp(
      r'\b\d{4}[\s-]+\d{4}[\s-]+\d{4}\b',
    );

    for (final match in formatted.allMatches(text)) {
      final number = match
          .group(0)!
          .replaceAll(RegExp(r'\D'), '');

      if (number.length == 12) {
        return number;
      }
    }

    final continuous = RegExp(r'\b\d{12}\b');

    final match = continuous.firstMatch(text);

    if (match != null) {
      return match.group(0);
    }

    return null;
  }

  String _formatAadhaar(String value) {
    final number = value.replaceAll(RegExp(r'\D'), '');

    if (number.length <= 4) {
      return number;
    }

    if (number.length <= 8) {
      return '${number.substring(0, 4)} '
          '${number.substring(4)}';
    }

    return '${number.substring(0, 4)} '
        '${number.substring(4, 8)} '
        '${number.substring(8, number.length > 12 ? 12 : number.length)}';
  }

  // ------------------------------------------------------------
  // DOB
  // ------------------------------------------------------------

// ------------------------------------------------------------
// DOB
// ------------------------------------------------------------

String? _extractDob(String text) {
  final lines = text
      .split('\n')
      .map((e) => e.trim())
      .where((e) => e.isNotEmpty)
      .toList();

  final dateRegex = RegExp(
    r'\b(0?[1-9]|[12]\d|3[01])[\/\-.](0?[1-9]|1[0-2])[\/\-.](19|20)\d{2}\b',
    caseSensitive: false,
  );

  // DOB ke labels
  final dobLabel = RegExp(
    r'\b(date\s*of\s*birth|dob|d\.o\.b|birth)\b',
    caseSensitive: false,
  );

  // In labels ke paas wali date DOB NAHI hai
  final excludeLabel = RegExp(
    r'(issue\s*date|date\s*of\s*issue|issued\s*on|'
    r'enrolment\s*date|enrollment\s*date|'
    r'update\s*date|updated\s*on|'
    r'valid\s*from|date\s*of\s*enrolment)',
    caseSensitive: false,
  );

  // ----------------------------------------------------------
  // 1. Sabse pehle DOB label wali line check karo
  // ----------------------------------------------------------

  for (int i = 0; i < lines.length; i++) {
    final line = lines[i];

    if (!dobLabel.hasMatch(line)) {
      continue;
    }

    // Same line:
    // DOB: 22/02/1997
    final sameLine = dateRegex.firstMatch(line);

    if (sameLine != null) {
      return sameLine.group(0);
    }

    // Next 2 lines:
    // DOB
    // 22/02/1997
    for (int j = i + 1; j <= i + 2 && j < lines.length; j++) {
      if (excludeLabel.hasMatch(lines[j])) {
        continue;
      }

      final match = dateRegex.firstMatch(lines[j]);

      if (match != null) {
        return match.group(0);
      }
    }
  }

  // ----------------------------------------------------------
  // 2. DOB label OCR mein thoda galat aaya ho
  // ----------------------------------------------------------

  final possibleDates = <String>[];

  for (int i = 0; i < lines.length; i++) {
    final line = lines[i];

    final matches = dateRegex.allMatches(line);

    for (final match in matches) {
      // Date wali line ke aas-paas issue/enrolment/update
      // mention hai to us date ko ignore karo.
      final start = i - 1 < 0 ? 0 : i - 1;
      final end = i + 1 >= lines.length
          ? lines.length - 1
          : i + 1;

      final context = lines
          .sublist(start, end + 1)
          .join(' ')
          .toLowerCase();

      if (excludeLabel.hasMatch(context)) {
        continue;
      }

      possibleDates.add(match.group(0)!);
    }
  }

  // Duplicate remove
  final uniqueDates = possibleDates.toSet().toList();

  // Sirf ek safe date mili
  if (uniqueDates.length == 1) {
    return uniqueDates.first;
  }

  // Multiple dates hain aur DOB label nahi mila:
  // random date ko DOB mat banao.
  return null;
}
  // ------------------------------------------------------------
  // GENDER
  // ------------------------------------------------------------

  String? _extractGender(String text) {
    final lower = text.toLowerCase();

    if (lower.contains('female')) {
      return 'Female';
    }

    if (lower.contains('male')) {
      return 'Male';
    }

    if (lower.contains('transgender')) {
      return 'Other';
    }

    return null;
  }

  // ------------------------------------------------------------
  // NAME
  // ------------------------------------------------------------

  String? _extractName(String text) {
    final lines = text
        .split('\n')
        .map((e) => e.trim())
        .where((e) => e.isNotEmpty)
        .toList();

    final ignored = [
      'government of india',
      'unique identification authority',
      'unique identification',
      'aadhaar',
      'uidai',
      'male',
      'female',
      'transgender',
      'dob',
      'date of birth',
      'year of birth',
    ];

    for (int i = 0; i < lines.length; i++) {
      final line = lines[i];
      final lower = line.toLowerCase();

      if (ignored.any((x) => lower.contains(x))) {
        continue;
      }

      if (RegExp(r'\d').hasMatch(line)) {
        continue;
      }

      final words = line.split(RegExp(r'\s+'));

      if (words.length >= 2 && words.length <= 6) {
        final valid = words.every(
          (word) => RegExp(r"^[A-Za-z.'-]+$").hasMatch(word),
        );

        if (valid) {
          return line;
        }
      }
    }

    return null;
  }

  // ------------------------------------------------------------
  // ADDRESS
  // ------------------------------------------------------------

  String? _extractAddress(String text) {
    final lines = text
        .split('\n')
        .map((e) => e.trim())
        .where((e) => e.isNotEmpty)
        .toList();

    final addressKeywords = [
      'address',
      's/o',
      'd/o',
      'w/o',
      'c/o',
      'house',
      'road',
      'street',
      'village',
      'taluka',
      'district',
      'state',
      'pin',
      'pincode',
      'maharashtra',
      'gujarat',
      'rajasthan',
      'madhya pradesh',
      'uttar pradesh',
      'delhi',
      'karnataka',
    ];

    final addressLines = <String>[];

    bool started = false;

    for (final line in lines) {
      final lower = line.toLowerCase();

      if (lower.contains('address')) {
        started = true;
      }

      if (started) {
        addressLines.add(line);
      } else if (addressKeywords.any(
        (keyword) => lower.contains(keyword),
      )) {
        started = true;
        addressLines.add(line);
      }
    }

    if (addressLines.isEmpty) {
      return lines
          .where(
            (line) =>
                line.length > 10 &&
                !RegExp(r'^\d+$').hasMatch(line),
          )
          .take(5)
          .join(', ');
    }

    return addressLines.take(8).join(', ');
  }

  // ------------------------------------------------------------
  // AADHAAR INPUT
  // ------------------------------------------------------------

  void _onAadhaarChanged(String value) {
    final formatted = _formatAadhaar(value);

    _aadhaarController.value = TextEditingValue(
      text: formatted,
      selection: TextSelection.collapsed(
        offset: formatted.length,
      ),
    );

    setState(() {});
  }

  // ------------------------------------------------------------
  // CONTINUE
  // ------------------------------------------------------------

  Future<void> _continue() async {
    final aadhaar = _aadhaarController.text
        .replaceAll(RegExp(r'\D'), '');

    if (_frontImage == null) {
      _showMessage('Please capture Aadhaar front side.');
      return;
    }

    if (_backImage == null) {
      _showMessage('Please capture Aadhaar back side.');
      return;
    }

    if (aadhaar.length != 12) {
      _showMessage('Please enter a valid 12-digit Aadhaar number.');
      return;
    }

    if (_nameController.text.trim().isEmpty) {
      _showMessage('Please enter the name.');
      return;
    }

    if (_dobController.text.trim().isEmpty) {
      _showMessage('Please enter date of birth.');
      return;
    }

    if (_gender.isEmpty) {
      _showMessage('Please select gender.');
      return;
    }

    if (_addressController.text.trim().isEmpty) {
      _showMessage('Please enter the address.');
      return;
    }

    final frontBytes = await _frontImage!.readAsBytes();
    final backBytes = await _backImage!.readAsBytes();

    if (!mounted) return;

    Navigator.pop(context, {
      'front_base64': base64Encode(frontBytes),
      'back_base64': base64Encode(backBytes),
      'name': _nameController.text.trim(),
      'dob': _dobController.text.trim(),
      'gender': _gender,
      'aadhaar_number': aadhaar,
      'address': _addressController.text.trim(),
    });
  }

  void _showMessage(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  // ------------------------------------------------------------
  // CLEAR
  // ------------------------------------------------------------

  void _clear() {
    setState(() {
      _frontImage = null;
      _backImage = null;

      _nameController.clear();
      _dobController.clear();
      _aadhaarController.clear();
      _addressController.clear();

      _gender = '';

      _frontMessage = '';
      _backMessage = '';

      _processingFront = false;
      _processingBack = false;
    });
  }

  // ------------------------------------------------------------
  // UI
  // ------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xffF5F7FB),
      appBar: AppBar(
        title: const Text(
          'Aadhaar Verification',
          style: TextStyle(
            fontWeight: FontWeight.w700,
          ),
        ),
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xff172033),
        elevation: 0,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(18),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Aadhaar Details',
                style: TextStyle(
                  fontSize: 28,
                  fontWeight: FontWeight.w800,
                  color: Color(0xff172033),
                ),
              ),
              const SizedBox(height: 6),
              const Text(
                'Capture both sides of Aadhaar and verify the detected information.',
                style: TextStyle(
                  color: Color(0xff667085),
                  height: 1.5,
                ),
              ),

              const SizedBox(height: 22),

              _buildSideCard(
                title: 'Aadhaar Front Side',
                image: _frontImage,
                processing: _processingFront,
                message: _frontMessage,
                onGallery: () =>
                    _pickFront(ImageSource.gallery),
                onCamera: () =>
                    _pickFront(ImageSource.camera),
              ),

              const SizedBox(height: 18),

              _buildField(
                label: 'Full Name',
                controller: _nameController,
                hint: 'Enter full name',
              ),

              _buildField(
                label: 'Date of Birth',
                controller: _dobController,
                hint: 'DD/MM/YYYY',
              ),

              const SizedBox(height: 4),

              const Text(
                'Gender',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                ),
              ),

              const SizedBox(height: 8),

              DropdownButtonFormField<String>(
                value: _gender.isEmpty ? null : _gender,
                decoration: InputDecoration(
                  hintText: 'Select gender',
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                  ),
                ),
                items: const [
                  DropdownMenuItem(
                    value: 'Male',
                    child: Text('Male'),
                  ),
                  DropdownMenuItem(
                    value: 'Female',
                    child: Text('Female'),
                  ),
                  DropdownMenuItem(
                    value: 'Other',
                    child: Text('Other'),
                  ),
                ],
                onChanged: (value) {
                  setState(() {
                    _gender = value ?? '';
                  });
                },
              ),

              _buildField(
                label: 'Aadhaar Number',
                controller: _aadhaarController,
                hint: 'XXXX XXXX XXXX',
                keyboardType: TextInputType.number,
                maxLength: 14,
                onChanged: _onAadhaarChanged,
              ),

              const SizedBox(height: 8),

              _buildSideCard(
                title: 'Aadhaar Back Side',
                image: _backImage,
                processing: _processingBack,
                message: _backMessage,
                onGallery: () =>
                    _pickBack(ImageSource.gallery),
                onCamera: () =>
                    _pickBack(ImageSource.camera),
              ),

              const SizedBox(height: 18),

              _buildField(
                label: 'Address',
                controller: _addressController,
                hint: 'Enter Aadhaar address',
                maxLines: 5,
              ),

              const SizedBox(height: 20),

              SizedBox(
                width: double.infinity,
                height: 52,
                child: ElevatedButton(
                  onPressed: _continue,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xff172033),
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10),
                    ),
                  ),
                  child: const Text(
                    'Continue',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),

              const SizedBox(height: 10),

              SizedBox(
                width: double.infinity,
                child: TextButton(
                  onPressed: _clear,
                  child: const Text(
                    'Clear All',
                    style: TextStyle(
                      color: Colors.red,
                    ),
                  ),
                ),
              ),

              const SizedBox(height: 10),

              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                    color: const Color(0xffE4E7EC),
                  ),
                ),
                child: const Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(
                      Icons.lock_outline,
                      color: Color(0xff315EFB),
                    ),
                    SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'Verify all Aadhaar details before saving. '
                        'Avoid logging or unnecessarily storing '
                        'the full Aadhaar number.',
                        style: TextStyle(
                          fontSize: 12,
                          color: Color(0xff667085),
                          height: 1.5,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ------------------------------------------------------------
  // SIDE CARD
  // ------------------------------------------------------------

  Widget _buildSideCard({
    required String title,
    required File? image,
    required bool processing,
    required String message,
    required VoidCallback onGallery,
    required VoidCallback onCamera,
  }) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: const Color(0xffE4E7EC),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w800,
            ),
          ),

          const SizedBox(height: 12),

          Container(
            width: double.infinity,
            height: 210,
            decoration: BoxDecoration(
              color: const Color(0xffF8FAFC),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: const Color(0xffD0D5DD),
              ),
            ),
            child: image == null
                ? const Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(
                        Icons.credit_card_outlined,
                        size: 48,
                        color: Color(0xff315EFB),
                      ),
                      SizedBox(height: 10),
                      Text(
                        'No image captured',
                        style: TextStyle(
                          fontWeight: FontWeight.w600,
                          color: Color(0xff667085),
                        ),
                      ),
                    ],
                  )
                : ClipRRect(
                    borderRadius: BorderRadius.circular(11),
                    child: Image.file(
                      image,
                      width: double.infinity,
                      height: double.infinity,
                      fit: BoxFit.contain,
                    ),
                  ),
          ),

          const SizedBox(height: 12),

          Row(
            children: [
              Expanded(
                child: ElevatedButton.icon(
                  onPressed: processing ? null : onCamera,
                  icon: const Icon(Icons.camera_alt_outlined),
                  label: const Text('Camera'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xff315EFB),
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(
                      vertical: 13,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: processing ? null : onGallery,
                  icon: const Icon(Icons.photo_library_outlined),
                  label: const Text('Gallery'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: const Color(0xff315EFB),
                    padding: const EdgeInsets.symmetric(
                      vertical: 13,
                    ),
                  ),
                ),
              ),
            ],
          ),

          if (processing) ...[
            const SizedBox(height: 14),
            const LinearProgressIndicator(),
            const SizedBox(height: 8),
            const Text(
              'Reading document...',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],

          if (message.isNotEmpty) ...[
            const SizedBox(height: 10),
            Text(
              message,
              style: const TextStyle(
                fontSize: 12,
                color: Color(0xff175CD3),
              ),
            ),
          ],
        ],
      ),
    );
  }

  // ------------------------------------------------------------
  // FIELD
  // ------------------------------------------------------------

  Widget _buildField({
    required String label,
    required TextEditingController controller,
    required String hint,
    TextInputType? keyboardType,
    int? maxLength,
    int maxLines = 1,
    ValueChanged<String>? onChanged,
  }) {
    return Padding(
      padding: const EdgeInsets.only(top: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: controller,
            keyboardType: keyboardType,
            maxLength: maxLength,
            maxLines: maxLines,
            onChanged: onChanged,
            decoration: InputDecoration(
              hintText: hint,
              counterText: '',
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: const BorderSide(
                  color: Color(0xffD0D5DD),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  @override
  void dispose() {
    _nameController.dispose();
    _dobController.dispose();
    _aadhaarController.dispose();
    _addressController.dispose();

    super.dispose();
  }
}