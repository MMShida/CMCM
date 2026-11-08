"""Build print HTML and vector diagrams for the exact 04:20 continuation. Stdlib only."""
from pathlib import Path
import html, json, re
ROOT=Path(__file__).resolve().parents[1]
DOC=ROOT/'docs/research-180'
FIG=DOC/'figures'
FIG.mkdir(exist_ok=True)
INK,BLUE,GREEN,ORANGE='#17324d','#306ea2','#16816b','#d1812c'
def esc(x): return html.escape(str(x))
def text(x,y,s,size=15,color=INK,anchor='middle'):
    return f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}" text-anchor="{anchor}">{esc(s)}</text>'
def box(x,y,w,h,title,sub='',color=BLUE):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="9" fill="#f0f5f9" stroke="{color}" stroke-width="1.5"/>'+text(x+w/2,y+27,title,15,color)+(text(x+w/2,y+49,sub,12) if sub else '')
def arrow(x1,y1,x2,y2,color=BLUE):
    return f'<path d="M{x1},{y1} L{x2},{y2}" fill="none" stroke="{color}" stroke-width="2" marker-end="url(#arrow)"/>'
def svg(name,body,height=250):
    value=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 {height}" role="img" aria-label="{esc(name)}"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 Z" fill="{BLUE}"/></marker></defs><rect width="720" height="{height}" fill="white"/><g font-family="Arial, sans-serif">{body}</g></svg>'
    (FIG/f'{name}.svg').write_text(value)
svg('architecture',box(180,5,360,60,'One seeded full-house audience','Unchanged geometry and physical parameters')+arrow(270,65,115,108)+arrow(360,65,360,108)+arrow(450,65,605,108)+box(5,112,220,72,'A · spatial agents','Rows, lanes, gaps, groups')+box(250,112,220,72,'B · network agents','FIFO service and travel')+box(495,112,220,72,'C · ideal flow','Coordinated benchmark')+text(360,218,'Shared inputs do not make the models interchangeable.',14),235)
svg('endpoints',box(5,10,205,65,'Inside building','All 1,329 people count')+arrow(210,43,255,43)+box(255,10,210,65,'Exterior crossing','Building-clearance endpoint',GREEN)+arrow(465,43,505,43)+box(505,10,210,65,'Street safety','Different endpoint')+box(245,115,315,65,'Accessible assistance point','Outside does not mean rescue is complete',ORANGE)+arrow(360,75,360,110),195)
b=''
for i,x in enumerate([90,270,450,630]):
    b+=text(x,20,f't = {i}Δt',14)
    for y,label in [(70,'u'),(165,'v')]:
        b+=f'<circle cx="{x}" cy="{y}" r="17" fill="#eff5f9" stroke="{BLUE}"/>'+text(x,y+5,label)
    if i<3:b+=arrow(x+20,70,x+158,70)+arrow(x+20,165,x+158,165)+arrow(x+15,85,x+165,150)
b+=text(360,213,'Horizontal: wait with finite storage. Diagonal: travel with finite capacity.',13)
svg('timeflow',b,230)
b=box(10,5,700,85,'Lane following: distance controls speed')+'<line x1="90" y1="65" x2="620" y2="65" stroke="#8095a8"/>'
for x in [200,410]:b+=f'<circle cx="{x}" cy="65" r="15" fill="{BLUE}"/>'
b+=arrow(220,65,390,65)+text(305,52,'available gap',12)
b+=box(10,110,210,65,'Accumulate service','credit + C × Δt')+arrow(220,142,255,142)+box(255,110,210,65,'Admit if space allows','consume one per person')+arrow(465,142,500,142)+box(500,110,210,65,'Cap idle remainder','preserve fractions',GREEN)
svg('movement',b,190)
svg('guidance',box(5,5,220,65,'Staff / announcement / LED','Consistent planned destination')+arrow(225,37,260,37)+box(260,5,200,65,'Hear, notice, accept','Probabilities unchanged')+arrow(460,37,495,37)+box(495,5,220,65,'Route utility','Other preferences still matter')+box(5,110,220,65,'Soft rope','Perceived crossing cost',ORANGE)+box(260,110,200,65,'Hard panel','Physical link closure',GREEN)+box(495,110,220,65,'No added capacity','Existing widths and rates'),195)
b='<path d="M65,100 L310,25 A250,250 0 0,1 310,175 Z" fill="#e3f3ed" stroke="#80b8a1"/>'
b+='<rect x="55" y="85" width="17" height="30" fill="#16816b"/>'+text(65,145,'sign',13)
b+=arrow(75,100,280,55,GREEN)+text(300,50,'eligible ray',12)
b+='<path d="M75,100 L320,145" stroke="#d1812c" stroke-dasharray="5 4" fill="none"/><path d="M220,108 V175" stroke="#17324d" stroke-width="7"/>'+text(260,205,'wall or opaque panel',12)
b+=box(425,10,280,55,'Geometry first','floor, range, angle, clear ray')+box(425,85,280,55,'One notice opportunity','same person-specific draws')+box(425,160,280,55,'One public message','never seat-personalized')
svg('visibility',b,230)
svg('partial',box(5,5,210,62,'Build queue arrivals','Current and pending route loads')+arrow(215,36,255,36)+box(255,5,210,62,'Chain FIFO departures','Account for upstream service')+arrow(465,36,505,36)+box(505,5,210,62,'Compare own finish','Detour and counterflow guards')+box(255,110,210,62,'If instruction accepted','Update both route loads',GREEN)+arrow(610,67,465,130)+arrow(255,140,115,67)+text(360,210,'Shared perfect state is a controller assumption; compliance remains imperfect.',13),230)
geo=json.loads((ROOT/'src/data/geometry/bailey-hall.json').read_text())
b=''
for floor,cx,label in [(1,180,'Orchestra and mezzanine'),(2,540,'Balcony')]:
    links=[l for l in geo['links'] if (2 if l['floor']==2 else 1)==floor]
    pts=[p for l in links for p in l['pts']]
    xmin,xmax=min(p[0] for p in pts),max(p[0] for p in pts)
    ymin,ymax=min(p[1] for p in pts),max(p[1] for p in pts)
    scale=min(315/(xmax-xmin),210/(ymax-ymin))
    def xy(p):return cx+(p[0]-(xmin+xmax)/2)*scale,35+(p[1]-ymin)*scale
    b+=text(cx,17,label,14)
    for l in links:
        pts=' '.join(f'{x:.2f},{y:.2f}' for x,y in map(xy,l['pts']))
        color=GREEN if l.get('exterior') else '#a0b3c2' if l['kind']=='row' else BLUE
        b+=f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="{2 if l.get("exterior") else .8}"/>'
    for p in geo['crowdManagerPosts']:
        if p['floor']==floor:
            x,y=xy((p['x'],p['y']));b+=f'<circle cx="{x}" cy="{y}" r="3" fill="{ORANGE}"/>'
b+=text(360,270,'Blue: walkable graph · Green: exterior links · Orange: existing staff posts',12)
svg('building',b,285)


# Compatibility entrypoint: PDF production now uses native LaTeX.
import subprocess
subprocess.run(['python3',str(ROOT/'scripts/build-latex-docs.py')],check=True)
