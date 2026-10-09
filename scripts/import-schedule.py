"""Import the Schedule sheet from the supplied SJL XLSX (stdlib only)."""
import datetime,json,sys,zipfile,xml.etree.ElementTree as E
from pathlib import Path
n={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(sys.argv[1]) as z:
 strings=[]
 if 'xl/sharedStrings.xml' in z.namelist():
  strings=[''.join(t.text or '' for t in e.findall('.//m:t',n)) for e in E.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si',n)]
 rows=[]
 for row in E.fromstring(z.read('xl/worksheets/sheet1.xml')).findall('.//m:row',n):
  cells={}
  for c in row:
   v=c.find('m:v',n); inline=c.find('m:is',n)
   val=v.text if v is not None else ''.join(inline.itertext()) if inline is not None else ''
   if c.get('t')=='s': val=strings[int(val)]
   cells[''.join(x for x in c.get('r') if x.isalpha())]=val
  rows.append(cells)
 header=next(i for i,r in enumerate(rows) if r.get('A')=='Date')
 matches=[]
 for row in rows[header+1:]:
  if not row.get('A'): continue
  date=(datetime.datetime(1899,12,30)+datetime.timedelta(days=float(row['A']))).date().isoformat()
  start,end=[part.strip() for part in row['B'].replace('—','–').replace('-','–').split('–',1)]
  for col,age,field in [('C','U10',1),('D','U10',2),('E','U13',3)]:
   home,away=row[col].split(' vs ',1)
   matches.append(dict(id=f'{date}-{field}',date=date,start=start,end=end,ageGroup=age,field=field,home=home,away=away))
 output={'season':'2026/27','timezone':'America/Winnipeg','source':Path(sys.argv[1]).name,'matches':matches}
 Path('assets/schedule.json').write_text(json.dumps(output,indent=2)+'\n')
 print(f'Imported {len(matches)} matches across {len(set(m["date"] for m in matches))} dates.')
