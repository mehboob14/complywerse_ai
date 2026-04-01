#!/usr/bin/env python3
"""
Advanced ETGRMF PDF Parser - Manual Control Extraction
Reads and extracts control details with proper structure preservation.
"""

import json
import sys
from pathlib import Path

try:
    import fitz
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "PyMuPDF"])
    import fitz


def extract_pdf_with_formatting(pdf_path: str) -> str:
    """Extract PDF text preserving some structure information."""
    try:
        doc = fitz.open(pdf_path)
        text = ""
        for page_num in range(len(doc)):
            page = doc[page_num]
            # Get text with block information
            text += page.get_text()
            text += "\n--- PAGE BREAK ---\n"
        return text
    except Exception as e:
        print(f"Error: {e}")
        return ""


def main():
    """Extract and display PDF content for manual analysis."""
    pdf_path = r"c:\Users\Admin\Documents\GRC-Tenant\backend\grc\seed_data\frameworks\SBP ETGRMF.pdf"
    
    print("📄 Extracting PDF content...\n")
    text = extract_pdf_with_formatting(pdf_path)
    
    # Save extracted text for analysis
    output_path = r"c:\Users\Admin\Documents\GRC-Tenant\ETGRMF_PDF_EXTRACTED.txt"
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(text)
    
    # Print first 10000 characters to see structure
    print("=" * 80)
    print("PDF CONTENT PREVIEW (First 5000 chars):")
    print("=" * 80)
    print(text[:5000])
    print("\n... [truncated] ...\n")
    
    # Print last 2000 characters
    print("=" * 80)
    print("PDF CONTENT TAIL (Last 2000 chars):")
    print("=" * 80)
    print(text[-2000:])
    
    print(f"\n✅ Full extracted text saved to: {output_path}")
    print(f"   Total characters: {len(text)}")


if __name__ == "__main__":
    main()
