"""Background work on an evidence file that was just uploaded: OCR, then the AI assessment, then (when the
upload says what the file is meant to prove) a check against that one requirement.

Lived in the framework upload module's evidence router until that feature was removed; the certification
journey upload still uses it.
"""
import logging

from ...models import Evidence
from .routers.ai_assessment import run_ai_assessment
from .routers.ocr import process_evidence_ocr

logger = logging.getLogger(__name__)


def trigger_ocr_and_assessment_background(evidence_id: int, user_id: int, target=None):
    """Background task to run OCR and then AI assessment on evidence.

    `target` is a `services.evidence_quality.QualityTarget` when the upload knows
    what the file is meant to prove; the file is then also reviewed against that
    one requirement, which the library assessment does not do.
    """
    from ...models import get_db as get_db_session

    db = next(get_db_session())
    try:
        evidence = db.query(Evidence).filter(Evidence.id == evidence_id).first()
        if not evidence:
            logger.error(f"Evidence {evidence_id} not found")
            return

        # Step 1: Run OCR to extract text content
        if not evidence.ocr_content:
            try:
                logger.info(f"Running OCR for evidence {evidence_id}")
                ocr_result = process_evidence_ocr(evidence, db)
                logger.info(f"OCR completed for evidence {evidence_id}: {ocr_result.status}")

                # Refresh evidence after OCR
                db.refresh(evidence)
            except Exception as e:
                logger.error(f"OCR failed for evidence {evidence_id}: {str(e)}")
                return

        # Step 2: Run AI assessment if OCR was successful
        if evidence.ocr_content:
            try:
                run_ai_assessment(evidence, db, mode="initial", user_id=user_id)
                logger.info(f"AI assessment completed for evidence {evidence_id}")
            except Exception as e:
                logger.error(f"AI assessment failed for evidence {evidence_id}: {str(e)}")
        else:
            logger.warning(f"Cannot run AI assessment for evidence {evidence_id} - no OCR content extracted")

        if target is not None:
            try:
                from ...services.evidence_quality import check_and_save

                check_and_save(db, evidence.tenant_id, evidence, target, user_id=user_id)
            except Exception:
                logger.exception("Evidence quality check failed for evidence %s", evidence_id)
    finally:
        db.close()
