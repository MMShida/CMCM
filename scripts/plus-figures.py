"""Original vector maps, drawn from the exported engine geometry and fixed policies."""
from pathlib import Path
import json,math,html
D=Path('docs/research-180/figures')
layouts=json.loads(Path('results/plus-study/layouts.json').read_text())
C={'FOYER':'#235d99','PORTICO_W':'#178067','PORTICO_E':'#178067','STAGE_W':'#b56a13','STAGE_E':'#b56a13','BAL_NW':'#7443a0','BAL_NE':'#7443a0'}
def text(x,y,s,size=12,color='#203548'):
 return f'<text x="{x:.2f}" y="{y:.2f}" font-family="Arial" font-size="{size}" fill="{color}">{html.escape(str(s))}</text>'
for item in layouts:
 if item['id'] not in ['selected','combined6','expanded-staff']:continue
 g=item['geo'];cfg=item['cfg'];out=[text(20,25,'A-Lite+ '+item['id']+' · '+str(item['resources']['staff'])+' crowd managers',19)]
 for floor in [1,2]:
  first=len(out);ox=20+(floor-1)*530;oy=55
  bounds=(-26,26,-21,40) if floor==1 else (-25,25,-20,22)
  scale=min(490/(bounds[1]-bounds[0]),440/(bounds[3]-bounds[2]))
  def point(x,y):return ox+245+x*scale,oy+20+(y-bounds[2])*scale
  def poly(pts,color,width=1,dash=''):
   return '<polyline points="'+' '.join(f'{point(x,y)[0]:.2f},{point(x,y)[1]:.2f}' for x,y in pts)+f'" fill="none" stroke="{color}" stroke-width="{width}"'+(f' stroke-dasharray="{dash}"' if dash else '')+'/>'
  out.append(text(ox,oy,'Main floor' if floor==1 else 'Balcony',15))
  for w in g['walls']:
   if w['floor']==floor and w['kind'] in ['wall','column']:out.append(poly(w['pts'],'#aab5bf',.8))
  for l in g['links']:
   if l['floor']!=floor or l['kind']=='outdoor':continue
   out.append(poly(l['pts'],'#e0e4e8' if l['kind']=='row' else '#b5c2cf',.5 if l['kind']=='row' else 1))
   if l.get('exterior'):
    x,y=point(*l['pts'][0]);out.append(f'<circle cx="{x}" cy="{y}" r="3" fill="#235d99"/>');out.append(text(x+4,y-4,l['id'],9))
  for b in item['barriers']:
   if b['floor']!=floor:continue
   color='#d47c0b' if b['type']=='belt' else '#087f94';out.append(poly(b['points'],color,4,'4 2' if b['type']=='belt' else ''));x,y=point(*b['points'][0]);out.append(text(x+4,y-6,b['slot']+' / '+f"{b['gap']:.1f} m",10,color))
  for s in cfg['plus']['signs']:
   if not cfg['led']['enabled'] or not s['enabled'] or s['floor']!=floor:continue
   color=C[s['exit']];x,y=point(s['x'],s['y'])
   if s.get('strip'):
    pts=s['strip']['points'];out.append(poly(pts,color,3));a,b=pts[-2:];angle=math.atan2(b[1]-a[1],b[0]-a[0]);out.append(poly([(b[0]-.6*math.cos(angle-.5),b[1]-.6*math.sin(angle-.5)),b,(b[0]-.6*math.cos(angle+.5),b[1]-.6*math.sin(angle+.5))],color,2))
   else:out.append(f'<rect x="{x-3}" y="{y-3}" width="6" height="6" fill="{color}"/>')
   out.append(text(x+4,y+(14 if s['id'] in ['L7','L8'] else -4),s['id'],10,color))
  for r in cfg['plus'].get('managerPatrols',[]):
   for id in r['links']:
    l=next(l for l in g['links'] if l['id']==id)
    if l['floor']==floor:out.append(poly(l['pts'],'#7c3aed',2,'3 3'))
  for m in item['posts']:
   if m['floor']!=floor:continue
   x,y=point(m['x'],m['y']);out.append(f'<circle cx="{x}" cy="{y}" r="5" fill="#203548"/>');out.append(text(x+6,y+(-10 if m['id'] in [3,4,10] else 12),'CM'+str(m['id']),10))
  x,y=ox+12,510;out.append(f'<path d="M{x},{y}h{5*scale}" stroke="#203548" stroke-width="2"/>');out.append(text(x,y+13,'5 m',10))
  title=text(20,25,'A-Lite+ '+item['id']+' · '+str(item['resources']['staff'])+' managers',18)
  body='<g transform="translate('+str(-(floor-1)*530)+',0)">'+''.join(out[first:])+'</g>'
  footer=text(20,546,'Blue: foyer; green: portico; orange: stage; purple: balcony exit.',11)+text(20,563,'Amber belt · teal rail · dark staff posts · dashed purple patrol.',11)
  single='<svg xmlns="http://www.w3.org/2000/svg" width="550" height="580" viewBox="0 0 550 580"><rect width="100%" height="100%" fill="white"/>'+title+body+footer+'</svg>'
  (D/('plus-'+item['id']+('-main' if floor==1 else '-balcony')+'.svg')).write_text(single)
