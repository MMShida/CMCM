# Native LaTeX technical documents

These PDFs are compiled from real LaTeX using Tectonic (XeTeX), with NewTX/TeX Gyre Termes text and mathematical fonts, numbered equations, vector figures, long tables, a linked contents page and linked bibliographies. They are not browser-printed HTML or rasterized equations.

From this directory, compile a source twice with XeLaTeX, or once with Tectonic (which performs its own reruns):

```
tectonic MODEL_GUIDE.tex
tectonic RESULTS_AND_CHANGES.tex
tectonic SIMPLIFICATION_AUDIT.tex
```

All figure PDFs are included under `figures/`. Only standard TeX packages are required; no shell escape is used. Tectonic fetches missing packages on first use. Compile from this directory so relative figure paths resolve.

The repository's maintained prose and equations are in the adjacent Markdown manuscripts. To regenerate the editable LaTeX sources and published PDFs from the repository root:

```
python3 scripts/build-latex-docs.py --compile
python3 scripts/check-research-pdfs.py
```

The generator requires Python 3 and PyMuPDF (`pip install pymupdf`); PDF compilation requires Tectonic on PATH. Editing generated `.tex` files directly is supported for a standalone submission, but regeneration will overwrite such edits. Use the Markdown manuscripts for ongoing repository edits.
