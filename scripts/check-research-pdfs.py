"""Check native LaTeX PDF provenance, glyph/overflow logs, references, math tags and page bounds."""
from pathlib import Path
import re,json,hashlib
import fitz
ROOT=Path(__file__).resolve().parents[1];D=ROOT/'docs/research-180';checks=[]
for stem in ['MODEL_GUIDE','RESULTS_AND_CHANGES','SIMPLIFICATION_AUDIT','IMPLEMENTATION_PROMPT']:
    pdf=fitz.open(D/(stem+'.pdf'));log=(D/'latex'/(stem+'.log')).read_text()
    bad=[line for line in log.splitlines() if re.search(r'Missing character:|Overfull \\[hv]box|LaTeX Warning:.*(?:undefined|multiply defined)|^!',line)]
    assert not bad,(stem,bad)
    assert 'xdvipdfmx' in pdf.metadata.get('producer','').lower(),(stem,pdf.metadata)
    text='\n'.join(p.get_text() for p in pdf)
    for literal in ['\\begin{','\\frac{','$$','\ufffd','<!','PLUS_CALIBRATION_']:assert literal not in text,(stem,literal)
    for i,p in enumerate(pdf):
        for b in p.get_text('blocks'):
            if b[4].strip():assert b[0]>=28 and b[2]<=p.rect.width-25 and b[1]>=15 and b[3]<=p.rect.height-20,(stem,i+1,b[:4],b[4][:80])
    tags=[str(n) for n in range(1,35)]+['16a','16b','16c'] if stem=='MODEL_GUIDE' else ['L'+str(n) for n in range(1,7)] if stem=='SIMPLIFICATION_AUDIT' else []
    figures=[]
    if stem=='IMPLEMENTATION_PROMPT':
        source=(D/'latex'/(stem+'.tex')).read_text()
        aux=(D/'latex'/(stem+'.aux')).read_text()
        equations=re.findall(r'\\newlabel\{impl:[^}]+\}\{\{(\d+)\}',aux)
        expected=re.findall(r'\\label\{impl:[^}]+\}',source)
        assert len(equations)==len(expected)>0,(stem,'missing equation labels')
        tags=[str(n) for n in range(1,max(map(int,equations))+1)]
        figures=re.findall(r'\\label\{(fig:[^}]+)\}',source)
        for number,label in enumerate(figures,1):
            assert re.search(r'\\newlabel\{'+re.escape(label)+r'\}\{\{'+str(number)+r'\}',aux),(stem,label)
            assert re.search(r'Figure\s+'+str(number)+r'\s*:',text),(stem,'missing caption',number)
        assert len(figures)==5,(stem,'expected five vector diagrams')
        for page in pdf:
            for link in page.get_links():
                if link['kind']==fitz.LINK_GOTO:assert 0<=link['page']<len(pdf),(stem,'invalid internal link',link)
    for tag in tags:assert '('+tag+')' in text,(stem,tag)
    if stem=='SIMPLIFICATION_AUDIT':
        for token in ['191.4','188.7','259.0','166.4','Unresolved','180']:assert token in text,(stem,token)
    fontids={font[0] for p in pdf for font in p.get_fonts()}
    for fid in fontids:
        font=pdf.extract_font(fid);assert font[3],(stem,'font not embedded',font[:3])
    checks.append({'document':stem,'pages':len(pdf),'links':sum(len(p.get_links()) for p in pdf),'bookmarks':len(pdf.get_toc()),'embeddedFonts':len(fontids),'equationsChecked':len(tags),'figuresChecked':len(figures),'producer':pdf.metadata['producer'],'sha256':hashlib.sha256((D/(stem+'.pdf')).read_bytes()).hexdigest(),'checks':'native LaTeX; embedded fonts; no missing glyphs, overfull boxes or unresolved references; all text within page bounds'})
    print(stem,len(pdf),'pages;',len(fontids),'embedded fonts;',len(tags),'equations; checks passed')
(ROOT/'results/plus-study/pdf-validation.json').write_text(json.dumps(checks,indent=2))
prompt=next(c for c in checks if c['document']=='IMPLEMENTATION_PROMPT')
(ROOT/'results/plus-study/prompt-validation.json').write_text(json.dumps({
    'pages':prompt['pages'],'links':prompt['links'],'nativeLaTeX':True,
    'missingGlyphsOrOverfullBoxes':False,'pageBoundsChecked':True,
    'equationsChecked':prompt['equationsChecked'],'figuresChecked':prompt['figuresChecked'],
    'sha256':prompt['sha256']},indent=2)+'\n')
