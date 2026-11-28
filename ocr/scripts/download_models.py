"""Download the Indra OCR weights into INDRA_OCR_MODEL_DIR at image build time.

The server passes INDRA_OCR_MODEL_DIR to indra_ocr.load(), and indra refuses to
start if that folder is missing files, so the image has to be built with the
weights in place. Math is off by default, which skips ~34 MB of extra models.
"""

from __future__ import annotations

import os

from huggingface_hub import snapshot_download
from indra_ocr.models import HF_REPO, HF_REVISION, download_patterns


def main() -> None:
    target = os.environ.get("INDRA_OCR_MODEL_DIR", "/opt/indra-models")
    math = os.environ.get("INDRA_MATH", "0") == "1"
    allow, ignore = download_patterns(math=math)
    snapshot_download(
        HF_REPO,
        revision=HF_REVISION,
        allow_patterns=allow,
        ignore_patterns=ignore,
        local_dir=target,
    )
    print(f"Indra OCR models ({'math' if math else 'no math'}) downloaded to {target}")


if __name__ == "__main__":
    main()
