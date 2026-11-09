"""Vector placement maps from the exact simulation configurations, in original geometry metres."""
from pathlib import Path
import json,math,html,shutil,sys
D=Path('docs/research-180/figures');D.mkdir(exist_ok=True)
g=json.load(open('src/data/geometry/bailey-hall.json'))
cases=json.load(open('results/placement-study/screen-cases.json'))
E=html.escape
COL={'FOYER':'#235d99','PORTICO_W':'#178067','PORTICO_E':'#178067','STAGE_W':'#b56a13','STAGE_E':'#b56a13','BAL_NW':'#7443a0','BAL_NE':'#7443a0'}
def txt(x,y,s,size=12,color='#203548',anchor='start'):
 return f'<text x="{x:.2f}" y="{y:.2f}" font-family="Arial" font-size="{size}" fill="{color}" text-anchor="{anchor}">{E(str(s))}</text>'
def panel(c,floor,ox,oy,w,h,title,all_slots=False,staff=False):
 sx=w/50;sy=(h-50)/43;scale=min(sx,sy)
 def point(x,y):return ox+w/2+x*scale,oy+30+(y+14)*scale
 def poly(points,color,width=1,dash=''):
  p=' '.join(f'{point(x,y)[0]:.2f},{point(x,y)[1]:.2f}' for x,y in points)
  return f'<polyline points="{p}" stroke="{color}" stroke-width="{width}" fill="none"'+(f' stroke-dasharray="{dash}"' if dash else '')+'/>'
 out=[txt(ox+8,oy+18,title,14)]
 for wall in g['walls']:
  if wall['floor']==floor and wall['kind'] in ['wall','column']:out.append(poly(wall['pts'],'#b9c1c8',.8))
 for l in g['links']:
  if l['floor']!=floor or l['kind']=='outdoor':continue
  out.append(poly(l['pts'],'#dbe1e5' if l['kind']=='row' else '#bac4cd',.5 if l['kind']=='row' else 1))
  if l.get('exterior'):
   p=l['pts'][0];x,y=point(*p);out.append(f'<circle cx="{x}" cy="{y}" r="3" fill="#235d99"/>');out.append(txt(x+3,y-3,l['id'],8))
 for l in g['links']:
  if l['floor']!=floor or not l.get('barrierSlot') or not(all_slots or l['id'] in c['barriers']):continue
  a,b=l['pts'][0],l['pts'][-1];dx,dy=b[0]-a[0],b[1]-a[1];norm=math.hypot(dx,dy);x,y=(a[0]+b[0])/2,(a[1]+b[1])/2
  u,v=-dy/norm*l['width']/2,dx/norm*l['width']/2
  rope=c.get('barrierTypes',{}).get(l['id'])=='soft-rope';out.append(poly([(x-u,y-v),(x+u,y+v)],'#cf6d17' if rope else '#c23838',3,'3 2' if rope else ''))
  label={'CO_3':'W0','CO_7':'W1','CO_10':'W2','CO_17':'E2','CO_20':'E1','CO_24':'E0'}[l['id']];px,py=point(x,y);out.append(txt(px+(-9 if x<0 else 9),py-3,label,10,anchor='end' if x<0 else 'start'))
 for s in c['led'].get('spatial',{}).get('signs',[]) if c['led']['enabled'] else []:
  if s['floor']!=floor:continue
  points=s['strip']['points'];out.append(poly(points,COL[s['exit']],3))
  a,b=points[-2:];ang=math.atan2(b[1]-a[1],b[0]-a[0]);q=[(b[0]-.6*math.cos(ang-.5),b[1]-.6*math.sin(ang-.5)),b,(b[0]-.6*math.cos(ang+.5),b[1]-.6*math.sin(ang+.5))];out.append(poly(q,COL[s['exit']],2))
  x,y=point(s['x'],s['y']);out.append(txt(x+4,y-4,s['id'],9,COL[s['exit']]))
 if staff:
  p=c['crowdManagers']['placement'];posts=g['crowdManagerPosts'][:6]
  if p!='existing':
   coords={'coverage':[(-5.1,-3.2,1),(5.1,-3.2,1),(-4.9,12.4,1),(4.9,12.4,1),(-18.4,2.85,2),(18.4,2.85,2)],'decision':[(0,-7,1),(0,12,1),(-16.5,7.5,1),(16.5,7.5,1),(-17.6,3.6,2),(17.6,3.6,2)]}[p]
   posts=[dict(x=x,y=y,floor=f,id='CM'+str(i+1)) for i,(x,y,f) in enumerate(coords)]
  for i,m in enumerate(posts):
   if m['floor']!=floor:continue
   x,y=point(m['x'],m['y']);out.append(f'<rect x="{x-4}" y="{y-4}" width="8" height="8" fill="#1e3447"/>');out.append(txt(x+6,y+11,'CM'+str(i+1),10))
 x,y=point(-21,24);out.append(f'<path d="M{x},{y}h{5*scale}" stroke="#203548" stroke-width="2"/>');out.append(txt(x,y+12,'5 m',9));out.append(txt(ox+w-25,oy+40,'N ↑',11))
 return ''.join(out)
def save(name,body,w,h):
 svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}"><rect width="100%" height="100%" fill="white"/>'+body+'</svg>'
 (D/(name+'.svg')).write_text(svg);pub=Path('public/docs/research-180/figures');pub.mkdir(parents=True,exist_ok=True);shutil.copyfile(D/(name+'.svg'),pub/(name+'.svg'))
body=txt(20,22,'Equal LED budgets: 12 strips × 2 m per layout; all candidate corridor slots marked in red',16)
for j,led in enumerate(['early','decision','corridor']):
 c=next(x['cfg'] for x in cases if x['id']=='existing-'+led+'-none')
 for floor in [1,2]:body+=panel(c,floor,10+j*360,40+(floor-1)*345,350,335,led.title()+(' · main floor' if floor==1 else ' · balcony'),True)
body+=txt(20,750,'Blue: foyer · green: portico · orange: stage · purple: balcony exits. Reconstruction; not a surveyed installation plan.',12)
save('placement-layouts',body,1100,770)
sel=Path('results/placement-study/selection.json')
if sel.exists():
 route='--config' in sys.argv
 c=json.load(open(sys.argv[sys.argv.index('--config')+1])) if route else json.loads(sel.read_text())['frozenCases'][1]['cfg'];body=txt(20,25,('Selected overall policy' if '--overall' in sys.argv else 'Selected combined intervention')+' · exactly six managers',19)
 for floor in [1,2]:body+=panel(c,floor,15+(floor-1)*530,45,515,475,'Main floor' if floor==1 else 'Balcony',False,True)
 body+=txt(20,540,'Squares: managers · colored arrows: 2 m LED strips · red: hard panels · dashed orange: ropes',13)
 body+=txt(20,562,'Coordinates and device IDs come from the frozen simulation configuration. +x east; +y south. Not to construction accuracy.',12)
 save(('route-overall' if '--overall' in sys.argv else 'route-selected') if route else 'placement-selected',body,1080,585)
print('Placement diagrams regenerated from configurations')
