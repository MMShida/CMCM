"""Generate editable, self-contained LaTeX sources and vector figures from the study manuscripts.
Compile with Tectonic. No browser printing, network assets, or rasterized mathematics.
"""
from pathlib import Path
import re,json,shutil,subprocess,argparse,zipfile
import fitz
ROOT=Path(__file__).resolve().parents[1]; D=ROOT/'docs/research-180'; TEX=D/'latex'
TEX.mkdir(exist_ok=True);(TEX/'figures').mkdir(exist_ok=True)
SUB=str.maketrans('₀₁₂₃₄₅₆₇₈₉ᵢⱼₑₖₘₙₚₛₜᵥₐᵣₕₗₒₓ','0123456789ijekmnpstvarhlox')
GREEK={'τ':r'\tau','π':r'\pi','θ':r'\theta','ρ':r'\rho','σ':r'\sigma','φ':r'\varphi','κ':r'\kappa','ε':r'\varepsilon','Δ':r'\Delta','Σ':r'\Sigma','α':r'\alpha','β':r'\beta','μ':r'\mu'}
SYMBOLS={'≤':r'\le','≥':r'\ge','≈':r'\approx','≠':r'\ne','±':r'\pm','×':r'\times','→':r'\to','↔':r'\leftrightarrow','∞':r'\infty','∈':r'\in','∫':r'\int','√':r'\sqrt{\vphantom x}','∼':r'\sim','²':r'{}^2','³':r'{}^3','⁻':r'{}^-','¹':r'{}^1','∑':r'\sum','∏':r'\prod'}
ESC={'&':r'\&','%':r'\%','$':r'\$','#':r'\#','_':r'\_','{':r'\{','}':r'\}','~':r'\textasciitilde{}','^':r'\textasciicircum{}','\\':r'\textbackslash{}'}

def escape(s):
    s=s.replace('T̄','⟦TBAR⟧').replace('D̄','⟦DBAR⟧').replace('P̂','⟦PHAT⟧').replace('p̂','⟦phat⟧').replace('T̂','⟦THAT⟧')
    out=[];i=0
    while i<len(s):
        m=re.match(r'([A-Za-zτρσφπθΔΣ])([₀₁₂₃₄₅₆₇₈₉ᵢⱼₑₖₘₙₚₛₜᵥₐᵣₕₗₒₓ]+)',s[i:])
        if m:out.append(r'\ensuremath{'+GREEK.get(m[1],m[1])+'_{'+m[2].translate(SUB)+'}}');i+=len(m[0]);continue
        c=s[i];i+=1
        if c in GREEK or c in SYMBOLS:out.append(r'\ensuremath{'+GREEK.get(c,SYMBOLS.get(c))+'}')
        elif c=='−':out.append(r'\ensuremath{-}')
        elif c=='…':out.append(r'\ldots{}')
        elif ord(c) in SUB:out.append(r'\ensuremath{{}_{'+c.translate(SUB)+'}}')
        elif c in ESC:out.append(ESC[c])
        else:out.append(c)
    ans=''.join(out)
    for k,v in {'TBAR':r'\overline T','DBAR':r'\overline D','PHAT':r'\widehat P','phat':r'\widehat p','THAT':r'\widehat T'}.items():ans=ans.replace('⟦'+k+'⟧',r'\ensuremath{'+v+'}')
    return ans

refs={}
for p in [D/'MODEL_GUIDE.md',D/'SIMPLIFICATION_SPEC.md']:
    for m in re.finditer(r'^\*\*\[([^]]+)\]\*\* (.+)$',p.read_text(),re.M):refs[m[1]]=m[2]

def inline(s,citations=True):
    saved=[]
    def keep(x):saved.append(x);return 'ZZLATEX'+str(len(saved)-1)+'ZZ'
    s=re.sub(r'`([^`]+)`',lambda m:keep(r'\code{'+m[1]+'}'),s)
    # Explicit Markdown currency must not be mistaken for paired inline math.
    s=re.sub(r'\\\$',lambda m:keep(r'\$'),s)
    s=re.sub(r'\[([^\]]+)\]\(([^)]+)\)',lambda m:keep(r'\href{'+m[2].replace('%',r'\%').replace('#',r'\#')+'}{'+inline(m[1],False)+'}'),s)
    s=re.sub(r'\$([^$\n]+)\$',lambda m:keep('$'+m[1]+'$'),s)
    s=re.sub(r'\*\*([^*]+)\*\*',lambda m:keep(r'\textbf{'+inline(m[1],citations)+'}'),s)
    s=re.sub(r'\*([^*]+)\*',lambda m:keep(r'\emph{'+inline(m[1],citations)+'}'),s)
    if citations:
        def cite(m):
            a=m[1].replace('–','-')
            if re.fullmatch(r'R\d+-R\d+',a):
                lo,hi=map(int,re.findall(r'\d+',a));a=','.join('R'+str(i) for i in range(lo,hi+1))
            keys=[]
            for part in a.split(','):
                part=part.strip()
                if re.fullmatch(r'R\d+-R\d+',part):
                    lo,hi=map(int,re.findall(r'\d+',part));keys.extend('R'+str(i) for i in range(lo,hi+1))
                else:keys.append(part)
            return keep(r'\cite{'+','.join(keys)+'}') if all(k in refs for k in keys) else m[0]
        s=re.sub(r'\[([RL][^\]\n]*)\]',cite,s)
    s=re.sub(r'(equations?) \((\d+[a-z]?)\)',lambda m:keep(m[1]+r'~\eqref{eq:'+m[2]+'}'),s,flags=re.I)
    s=re.sub(r'§(\d+[a-z]?)',lambda m:keep(r'Section~\ref{sec:'+m[1]+'}'),s)
    s=escape(s)
    for i,x in reversed(list(enumerate(saved))):s=s.replace('ZZLATEX'+str(i)+'ZZ',x)
    return s

PREAMBLE=r'''\documentclass[11pt,a4paper]{article}
\usepackage[T1]{fontenc}
\usepackage{amsmath}
\usepackage{newtxtext,newtxmath}
\usepackage{graphicx,booktabs,longtable,array,geometry,microtype}
\usepackage{xcolor,fancyhdr,caption,enumitem,needspace,xurl,hyperref,bookmark}
\geometry{left=25mm,right=25mm,top=23mm,bottom=24mm,headheight=14pt,headsep=8mm}
\definecolor{ink}{HTML}{203548}
\definecolor{linkblue}{HTML}{245A79}
\hypersetup{hypertexnames=false,colorlinks=true,linkcolor=linkblue,citecolor=linkblue,urlcolor=linkblue,
 pdftitle={TITLEMETA},pdfauthor={CMCM 2026 Bailey Hall modelling study},pdfsubject={Mathematical model and reproducible verification}}
\urlstyle{tt}
\newcommand{\code}[1]{{\small\nolinkurl{#1}}}
\setlength{\parindent}{0pt}
\setlength{\parskip}{5.5pt plus 1pt minus 1pt}
\setlength{\emergencystretch}{2em}
\linespread{1.045}
\setcounter{tocdepth}{1}
\setlength{\tabcolsep}{4pt}
\renewcommand{\arraystretch}{1.18}
\setlength{\LTpre}{8pt}
\setlength{\LTpost}{8pt}
\captionsetup{font=small,labelfont=bf,justification=raggedright,singlelinecheck=false}
\pagestyle{fancy}
\fancyhf{}
\fancyhead[L]{\small\textsc{Bailey Hall evacuation modelling}}
\fancyhead[R]{\small TECHNICAL REPORT}
\fancyfoot[L]{\footnotesize CMCM 2026\enspace/\enspace Base revision \texttt{3e4bcf0}}
\fancyfoot[R]{\small\thepage}
\renewcommand{\headrulewidth}{0.35pt}
\renewcommand{\footrulewidth}{0pt}
\setlist{itemsep=2pt,topsep=4pt,leftmargin=1.5em}
\widowpenalty=10000
\clubpenalty=10000
\displaywidowpenalty=10000
\allowdisplaybreaks[0]
\begin{document}
\special{pdf:minorversion 7}
'''
META={
'MODEL_GUIDE':('Bailey Hall evacuation modelling','Mathematical specification, assumptions and verification','This document develops the model from flow conservation and travel times to heterogeneous agents, spatial interactions, imperfect guidance and the A-Lite+ primary model, with physical installations, local information and explicit instruction execution. The original A/B/C/Lite engines remain reference models. Equations describe the implemented rules; citations justify modelling mechanisms without treating unmeasured coefficients as Bailey-specific evidence. The audience remains 1,329 people, including three wheelchair users. The quantity of interest is the mean, over independent audiences, of the last person\'s exterior-boundary crossing time. The companion experimental reports distinguish numerical corrections, structural simplifications and parameter calibration.'),
'RESULTS_AND_CHANGES':('Interventions and changes from Mateus\'s 04:20 model','Experimental results and reproducibility record','This report evaluates the final A-Lite+ model with six managers, physical LED guidance and low-profile removable barriers. A frozen research-bounded calibration precedes operational search, independent confirmation, controlled ablations, obstruction tests and numerical refinement. It answers all five competition questions, reports indicative costs, and distinguishes computational verification from missing empirical Bailey validation. Historical engines and results remain reproducible.'),
'SIMPLIFICATION_AUDIT':('A-Lite: a spatial queue model for Bailey Hall','Mechanism audit, mathematical specification and comparative experiments','This report tests whether a spatial queue representation can remove unsupported microscopic detail while retaining the full audience, original graph, finite passage storage, physical gate capacities, heterogeneous response and imperfect guidance. Numerical corrections, individual ablations, operational optimization and calibration changes are evaluated separately. Original Model A remains the benchmark. Independent confirmation, failures, time-step sensitivity and the effects lost by simplification determine the recommendation.')}

def render(text,stem):
    # Manuscript maintenance markers are not reader-facing text. Remove them
    # before paragraph collection, which can otherwise consume a closing marker.
    text=re.sub(r'<!--.*?-->','',text,flags=re.S)
    # Bibliography entries are collected centrally and typeset once at the end.
    text=re.sub(r'^\*\*\[[^]]+\]\*\* .+\n?','',text,flags=re.M)
    text=re.sub(r'^\[R3–R19\].+\n?','',text,flags=re.M)
    lines=text.splitlines();out=[];i=0;table=0;section='Model specification'
    while i<len(lines):
        s=lines[i].strip();i+=1
        if not s or s.startswith('<!--'):continue
        if s.startswith('# '):continue
        if s.startswith('## '):
            h=s[3:];m=re.match(r'(\d+[a-z]?)\.\s*(.*)',h)
            if 'References' in h or h.lower().startswith('references'):continue
            section=m[2] if m else h
            out.append(r'\section{'+inline(section)+'}'+(r'\label{sec:'+m[1]+'}' if m else ''));continue
        if s.startswith('### '):out.append(r'\subsection{'+inline(s[4:])+'}');continue
        if s=='$$':
            a=[]
            while i<len(lines) and lines[i].strip()!='$$':a.append(lines[i]);i+=1
            i+=1;eq='\n'.join(a);tag=re.search(r'\\tag\{([^}]+)\}',eq)
            out.append(r'\begin{equation}'+'\n'+eq+(r'\label{eq:'+tag[1]+'}' if tag else '')+'\n'+r'\end{equation}');continue
        if s.startswith('```'):
            a=[]
            while i<len(lines) and not lines[i].startswith('```'):a.append(lines[i]);i+=1
            i+=1;out.append(r'\begin{quote}\small\ttfamily'+'\n'+r'\\'.join(r'\nolinkurl{'+x+'}' for x in a)+r'\end{quote}');continue
        m=re.fullmatch(r'!\[([^]]*)\]\(([^)]+)\)',s)
        if m:
            f=D/m[2];dest=TEX/'figures'/(f.stem+'.pdf')
            if f.suffix=='.svg':
                doc=fitz.open('svg',f.read_bytes());pdf=fitz.open('pdf',doc.convert_to_pdf())
                same=False
                if dest.exists():
                    old=fitz.open(dest)
                    same=len(old)==len(pdf) and all(a.rect==b.rect and a.get_text('dict')==b.get_text('dict') and a.get_drawings()==b.get_drawings() and a.get_pixmap().samples==b.get_pixmap().samples for a,b in zip(old,pdf))
                    old.close()
                if not same:pdf.save(dest)
                pdf.close();doc.close()
            elif f.suffix=='.pdf':shutil.copyfile(f,dest)
            else:dest=TEX/'figures'/f.name;shutil.copyfile(f,dest)
            height='.68' if f.stem.startswith('plus-') and f.stem.endswith(('-main','-balcony')) else '.82' if f.stem=='placement-layouts' else '.48' if f.stem=='placement-selected' or f.stem.startswith('plus-selected') or f.stem.startswith('plus-combined') else '.30'
            out.append(r'\begin{figure}[htbp]\centering'+'\n'+r'\includegraphics[width=\linewidth,height='+height+r'\textheight,keepaspectratio]{figures/'+dest.name+'}\n'+r'\caption{'+inline(m[1])+'}'+r'\label{fig:'+f.stem+'}\n'+r'\end{figure}');continue
        if s.startswith('|'):
            rows=[s]
            while i<len(lines) and lines[i].strip().startswith('|'):rows.append(lines[i].strip());i+=1
            rows=[[x.strip() for x in row.strip('|').split('|')] for row in rows]
            rows=[row for row in rows if not all(re.fullmatch(r':?-+:?',v) for v in row)]
            n=len(rows[0]);table+=1
            weights={2:[.29,.71],3:[.26,.34,.40],4:[.23,.16,.23,.38],5:[.34,.12,.26,.14,.14],6:[.30,.25,.17,.10,.09,.09],7:[.28,.16,.14,.12,.10,.10,.10],8:[.31,.09,.09,.09,.09,.09,.09,.15]}.get(n,[1/n]*n)
            if stem=='RESULTS_AND_CHANGES' and n==5:weights=[.30,.06,.28,.08,.28]
            if stem=='RESULTS_AND_CHANGES' and n==8:weights=[.22,.10,.09,.12,.12,.13,.11,.11]
            if n==5 and 'Wilson' in ' '.join(rows[0]):weights=[.27,.07,.26,.10,.30]
            if n==6 and rows[0][1]=='Model':weights=[.28,.07,.07,.30,.17,.11]
            # Widths plus intercolumn padding total exactly linewidth.
            spec='@{}'+''.join(r'>{\raggedright\arraybackslash}p{\dimexpr '+f'{w:.4f}'+r'\linewidth-'+f'{2*(n-1)*4*w:.3f}'+r'pt\relax}' for w in weights)+'@{}'
            head=' & '.join(r'\textbf{'+inline(v)+'}' for v in rows[0])+r' \\'
            body='\n'.join(' & '.join(inline(v) for v in row)+r' \\' for row in rows[1:])
            out.append(r'\begingroup\small'+'\n'+r'\begin{longtable}{'+spec+'}\n'+r'\caption{'+inline(section)+r'.}\label{tab:'+str(table)+r'}\\'+'\n'+r'\toprule'+'\n'+head+'\n'+r'\midrule\endfirsthead'+'\n'+r'\multicolumn{'+str(n)+r'}{l}{\small\itshape Table \thetable{} continued}\\\toprule'+'\n'+head+'\n'+r'\midrule\endhead'+'\n'+r'\midrule\multicolumn{'+str(n)+r'}{r}{\small Continued on next page}\\\endfoot'+'\n'+r'\bottomrule\endlastfoot'+'\n'+body+'\n'+r'\end{longtable}\endgroup');continue
        if s.startswith(('- ','* ')) or re.match(r'^\d+\. ',s):
            numbered=bool(re.match(r'^\d+\. ',s));env='enumerate' if numbered else 'itemize';items=[s]
            while i<len(lines) and (lines[i].startswith(('- ','* ')) or re.match(r'^\d+\. ',lines[i])):items.append(lines[i]);i+=1
            out.append(r'\begin{'+env+'}'+'\n'+'\n'.join(r'\item '+inline(re.sub(r'^(?:[-*]|\d+\.)\s+','',x)) for x in items)+'\n'+r'\end{'+env+'}');continue
        para=[s]
        while i<len(lines) and lines[i].strip() and not lines[i].startswith(('#','|','![','$$','```','- ')):para.append(lines[i].strip());i+=1
        out.append(inline(' '.join(para))+'\n')
    return '\n\n'.join(out)

def build(stem):
    path=D/(stem+'.md')
    if not path.exists():return
    title,sub,abstract=META[stem]
    pre=PREAMBLE.replace('TITLEMETA',escape(title))
    cover=r'''\begin{titlepage}
\thispagestyle{empty}
{\small\scshape CMCM 2026\quad Technical documentation}\par
\vspace{22mm}
{\Huge\bfseries TITLE\par}
\vspace{7mm}
{\Large SUBTITLE\par}
\vspace{12mm}
{\color{ink}\rule{\linewidth}{0.7pt}}\par
\vspace{5mm}
\textbf{Abstract}\par
ABSTRACT
\vfill
\begin{tabular}{@{}ll@{}}
Study & Bailey Hall, full-house evacuation\\
Audience & 1,329 occupants, including three wheelchair users\\
Base revision & Mateus, \texttt{3e4bcf0}, 8 November 2026, 04:20:42 EST\\
Report date & 8 November 2026\\
Scope & Research model; assumptions and calibration limits stated explicitly
\end{tabular}
\vspace{9mm}
\end{titlepage}
\pagenumbering{roman}
{\small\tableofcontents}
\clearpage
\pagenumbering{arabic}
'''.replace('SUBTITLE',escape(sub)).replace('TITLE',escape(title)).replace('ABSTRACT',inline(abstract))
    if stem=='RESULTS_AND_CHANGES' and (D/'EXECUTIVE_SUMMARY.md').exists():
        summary=r'\thispagestyle{empty}\section*{Executive summary}'+'\n'+render((D/'EXECUTIVE_SUMMARY.md').read_text(),stem)+r'\clearpage'+'\n'
        cover=cover.replace(r'\pagenumbering{roman}',summary+r'\pagenumbering{roman}')
    main=render(path.read_text(),stem)
    # Include every cited entry, including evidence inherited by the standalone A-Lite specification.
    keys=[]
    for group in re.findall(r'\\cite\{([^}]+)\}',main):
        for k in group.split(','):
            if k not in keys:keys.append(k)
    bib='\n\\clearpage\n\\begin{thebibliography}{L-R19}\n\\addcontentsline{toc}{section}{References}\n'+ '\n\n'.join(r'\bibitem['+k+']{'+k+'} '+inline(refs[k].replace("§7", "the Model Guide route-choice section"),False) for k in keys)+'\n\\end{thebibliography}\n'
    (TEX/(stem+'.tex')).write_text(pre+cover+main+(bib if keys else '')+r'\end{document}'+'\n')
    print(stem,'LaTeX source generated;',len(keys),'bibliographic entries')

if __name__=='__main__':
    available=[*META,'IMPLEMENTATION_PROMPT']
    p=argparse.ArgumentParser();p.add_argument('--compile',action='store_true');p.add_argument('--stem',choices=available);args=p.parse_args()
    stems=[args.stem] if args.stem else available
    for stem in stems:
        if stem in META:build(stem)
        if args.compile and (TEX/(stem+'.tex')).exists():
            subprocess.run(['tectonic','--keep-logs','--keep-intermediates','--outdir',str(TEX),str(TEX/(stem+'.tex'))],cwd=TEX,check=True)
            shutil.copyfile(TEX/(stem+'.pdf'),D/(stem+'.pdf'))
            dest=ROOT/'public/docs/research-180';dest.mkdir(parents=True,exist_ok=True);shutil.copyfile(D/(stem+'.pdf'),dest/(stem+'.pdf'))

    if args.compile:
        bundle=D/'BAILEY_LATEX_SOURCES.zip'
        with zipfile.ZipFile(bundle,'w',zipfile.ZIP_DEFLATED) as archive:
            for p in sorted(TEX.rglob('*')):
                if p.is_file() and (p.suffix=='.tex' or p.parent.name=='figures' and p.suffix=='.pdf' or p.name=='README.md'):
                    archive.write(p,'bailey-technical-documents/'+str(p.relative_to(TEX)))
        shutil.copyfile(bundle,ROOT/'public/docs/research-180'/bundle.name)
        print('Editable LaTeX source bundle published')
