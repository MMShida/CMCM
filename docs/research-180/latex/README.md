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

`IMPLEMENTATION_PROMPT.tex` is a standalone prompt maintained directly in LaTeX. It specifies A-Lite+'s state, equations, update order, decisions and physical installations, with five native TikZ vector diagrams, a numerical example and replay checks. The full build also compiles it.

To rebuild only the prompt and refresh its published PDF and the source bundle, run from the repository root:

```
python3 scripts/build-latex-docs.py --compile --stem IMPLEMENTATION_PROMPT
python3 scripts/check-research-pdfs.py
```

For a standalone copy, use `tectonic --keep-logs --keep-intermediates IMPLEMENTATION_PROMPT.tex` in this directory. Its diagrams are embedded in the `.tex` source; no external image files or shell escape are needed. The PDF checker verifies its numbered equations, five figure captions, internal links, embedded fonts and page bounds. This document revision changes the specification and illustrations, not the simulation engine or archived results.
