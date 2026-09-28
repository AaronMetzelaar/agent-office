from chars import head, tokens
OUT='../metro-canvas/project/'
col=dict(b='c.brainstorm',p='c.plan',w='c.work',r='c.review',s='c.ship')
# stage columns (x ranges) inside a ~900px map
COLS=[('Brainstorm',250,320),('Plan',320,390),('Work',390,640),('Review',640,710),('Ship',710,780),('Merged',780,850)]
BX,PX,RX,S1,S2,MX=285,355,675,735,760,815
W0,W1=405,625
SRCC={'SE':'#fb923c','GH':'#a78bfa','LN':'#34d399'}
def xs(stops, w0=None):
    n=stops.count('w'); out=[]; k=0; s=0; a=W0 if w0 is None else w0
    for ch in stops:
        if ch=='b': out.append(BX)
        elif ch=='p': out.append(PX)
        elif ch=='w': out.append(a+(k+0.5)*(W1-a)/n); k+=1
        elif ch=='r': out.append(RX)
        elif ch=='s': out.append(S1 if s==0 else S2); s+=1
    return out
o=[]
def halo(x,y,txt,fill,anchor='start',weight=500,size=12):
    return f'<text x="{x:.0f}" y="{y:.0f}" fill="{{{{{fill}}}}}" font-size="{size}" font-weight="{weight}" text-anchor="{anchor}" stroke="{{{{t.bg}}}}" stroke-width="4" paint-order="stroke" stroke-linejoin="round">{txt}</text>'
def line(name, stops, cur, state, y, hub=None, start=None, status='', source=None, hl=False, fade=False):
    X=xs(stops, None if hub else start[0]+abs(y-start[1]))
    g=['<g opacity="0.45">' if fade else '<g>']
    if hub:
        hx,hy=hub; d=abs(y-hy); lead=[(hx,hy),(150,hy),(150+d,y)]
    else:
        ox,oy=start; lead=[(ox,oy),(ox+abs(y-oy),y)]
    first=lead[-1][0]
    endx = MX if state=='done' else X[cur]
    if state!='done': g.append(f'<line x1="{endx:.0f}" y1="{y}" x2="{MX}" y2="{y}" stroke="{{{{t.faint}}}}" stroke-width="1.5"></line>')
    skip = hub is not None and stops[0]!='b'
    lp=' '.join(f'{a:.0f},{b:.0f}' for a,b in lead)
    w = 6 if hl else 4.5
    if skip:
        g.append(f'<polyline points="{lp}" fill="none" stroke="{{{{t.muted}}}}" stroke-width="1.5" stroke-dasharray="3 4" stroke-linejoin="round"></polyline>')
        g.append(f'<line x1="{first:.0f}" y1="{y}" x2="{X[0]:.0f}" y2="{y}" stroke="{{{{t.muted}}}}" stroke-width="1.5" stroke-dasharray="3 4"></line>')
    else:
        g.append(f'<polyline points="{lp}" fill="none" stroke="{{{{{col[stops[0]]}}}}}" stroke-width="{w}" stroke-linejoin="round"></polyline>')
        g.append(f'<line x1="{first:.0f}" y1="{y}" x2="{X[0]:.0f}" y2="{y}" stroke="{{{{{col[stops[0]]}}}}}" stroke-width="{w}"></line>')
    upto = len(stops)-1 if state=='done' else cur
    for i in range(1, upto+1):
        g.append(f'<line x1="{X[i-1]:.0f}" y1="{y}" x2="{X[i]:.0f}" y2="{y}" stroke="{{{{{col[stops[i]]}}}}}" stroke-width="{w}"></line>')
    if state=='done':
        g.append(f'<line x1="{X[-1]:.0f}" y1="{y}" x2="{MX}" y2="{y}" stroke="{{{{c.ship}}}}" stroke-width="{w}"></line>')
    n_done = len(stops) if state=='done' else cur
    if n_done>0:
        mid=((first+endx)/2)
        lab='merged' if state=='done' else f'{n_done} done'
        wpill=len(lab)*5.8+12
        g.append(f'<rect x="{mid-wpill/2:.0f}" y="{y-7}" width="{wpill:.0f}" height="14" rx="7" fill="{{{{t.bg}}}}" stroke="{{{{t.faint}}}}" stroke-width="1"></rect><text x="{mid:.0f}" y="{y+3.5}" fill="{{{{t.muted}}}}" font-size="9.5" text-anchor="middle">{lab}</text>')
    for i,x in enumerate(X):
        if i<=cur and state!='done': continue
        if state=='done': continue
        g.append(f'<circle cx="{x:.0f}" cy="{y}" r="2.8" fill="{{{{t.bg}}}}" stroke="{{{{t.faint}}}}" stroke-width="1.3"></circle>')
    # title
    tx = first+6
    if source:
        g.append(f'<rect x="{tx:.0f}" y="{y-17}" width="7" height="7" rx="2" fill="{SRCC[source]}"></rect>'); tx+=11
    g.append(halo(tx,y-9,name,'t.ink',weight=600))
    if state!='done':
        x=X[cur]
        ring={'needs':'s.needs','blocked':'s.fail','idle':'t.muted','work':col[stops[cur]],'review':col[stops[cur]]}[state]
        if hl: g.append(f'<circle cx="{x:.0f}" cy="{y}" r="14" fill="none" stroke="{{{{s.needs}}}}" stroke-width="1" opacity="0.5"></circle>')
        g.append(f'<circle cx="{x:.0f}" cy="{y}" r="7.5" fill="{{{{t.bg}}}}" stroke="{{{{{ring}}}}}" stroke-width="3"></circle><circle cx="{x:.0f}" cy="{y}" r="2.5" fill="{{{{t.ink}}}}"></circle>')
        tone={'needs':'s.needsInk','blocked':'s.failInk','idle':'t.muted','work':'t.muted','review':'t.ink'}[state]
        if status:
            if x>560: g.append(halo(x-14,y+4,status,tone,'end',size=11.5))
            else: g.append(halo(x+14,y+4,status,tone,size=11.5))
    else:
        g.append(f'<rect x="{MX-8}" y="{y-7}" width="16" height="14" rx="7" fill="{{{{t.bg}}}}" stroke="{{{{t.ink}}}}" stroke-width="1.8"></rect>')
    g.append('</g>'); o.extend(g); return X
def hubbox(y,repo):
    o.append(f'<rect x="16" y="{y-14}" width="134" height="28" rx="14" fill="{{{{t.bg}}}}" stroke="{{{{t.ink}}}}" stroke-width="2"></rect>')
    o.append(f'<text x="30" y="{y+4}" fill="{{{{t.ink}}}}" font-size="12" font-weight="600">{repo}</text>')
    o.append(f'<text x="138" y="{y+4}" fill="{{{{t.muted}}}}" font-size="10" text-anchor="end" font-family="Geist Mono, monospace">main</text>')
for name,a,b in COLS:
    o.append(f'<line x1="{a}" y1="40" x2="{a}" y2="700" stroke="{{{{t.grid}}}}" stroke-width="1"></line>')
    o.append(f'<text x="{(a+b)/2:.0f}" y="30" fill="{{{{t.muted}}}}" font-size="11" text-anchor="middle">{name}</text>')
# habit-tracker
line('Habit tracker','bpwwwwwwwwwrs',7,'work',80,hub=(16,80),status='task 6 of 9'); hubbox(80,'habit-tracker')
# agent-office
hy=210
RX_=line('Rail renderer','bpwwwwwrs',4,'needs',174,hub=(16,hy),hl=True)
line('Try canvas','www',1,'review',210,start=(RX_[2],174),status='results ready')
line('Metro workspace','bpwrs',1,'review',246,hub=(16,hy),status='plan ready')
line('Resume login-stuck chats','bpwrs',5,'done',282,hub=(16,hy),fade=True)
hubbox(hy,'agent-office')
# monorepo
hy=470
line('Fixing the saved-cards crash','wwrs',2,'review',382,hub=(16,hy),status='fix ready',source='SE')
line('Dependabot security updates','wrs',0,'work',418,hub=(16,hy),status='tests running',source='GH')
line('Checkout: saved cards','pwwwwrs',5,'work',454,hub=(16,hy),status='reviewing')
line('Answer comments #212','wrss',2,'needs',490,hub=(16,hy))
line('Admin: bulk export','bpwrs',1,'blocked',526,hub=(16,hy),status='waits for #214')
line('Review #219','rs',0,'idle',562,hub=(16,hy),status='not started')
hubbox(hy,'monorepo')
svg='\n'.join(o)

# ---------- right column (triage)
KEY=lambda k: f'<span style="font-family: \'Geist Mono\', monospace; font-size: 10.5px; opacity: 0.6">{k}</span>'
def b(label, primary=False, key=''):
    k = f' {KEY(key)}' if key else ''
    if primary: return f'<button type="button" style="all: unset; cursor: pointer; height: 24px; padding: 0 9px; border-radius: 6px; background: {{{{t.ink}}}}; color: {{{{t.bg}}}}; font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 5px">{label}{k}</button>'
    return f'<button type="button" style="all: unset; cursor: pointer; box-sizing: border-box; height: 24px; padding: 0 9px; border-radius: 6px; border: 1px solid {{{{t.line}}}}; font-size: 12px; display: flex; align-items: center; gap: 5px">{label}{k}</button>'
def ring(c, amber=False):
    cc='{{s.needs}}' if amber else c
    return f'<span style="width: 10px; height: 10px; flex-shrink: 0; margin-top: 4px; box-sizing: border-box; border-radius: 50%; border: 2.5px solid {cc}"></span>'
def row(c, name, what, actions, amber=False, hl=False, src=None):
    s = f'<span style="width: 7px; height: 7px; border-radius: 2px; background: {SRCC[src]}"></span>' if src else ''
    bg = 'background: {{t.sel}};' if hl else ''
    return f'''<div style="display: flex; gap: 10px; padding: 8px 10px; border-radius: 8px; {bg}">
{ring(c,amber)}
<div style="flex-grow: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px">
<span style="display: flex; align-items: center; gap: 7px"><span style="font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">{name}</span>{s}</span>
<span style="font-size: 12.5px; color: {{{{t.ink2}}}}; line-height: 1.4">{what}</span>
<span style="display: flex; gap: 6px">{actions}</span>
</div>
</div>'''
def sect(title, n, hint=''):
    return f'<div style="display: flex; align-items: baseline; gap: 8px; padding: 0 10px"><span style="font-size: 12.5px; font-weight: 600">{title}</span><span style="font-size: 12px; color: {{{{t.muted}}}}">{n}</span><span style="margin-left: auto; font-size: 11px; color: {{{{t.muted}}}}">{hint}</span></div>'
W='{{c.work}}'; P='{{c.plan}}'; R='{{c.review}}'; Sh='{{c.ship}}'; B='{{c.brainstorm}}'
right = r'''<aside aria-label="Where you're needed" style="width: 440px; flex-shrink: 0; display: flex; flex-direction: column; gap: 10px; padding: 16px 14px; background: {{t.panel}}; border-left: 1px solid {{t.line}}; overflow: hidden">
<form style="display: flex; align-items: center; gap: 8px; height: 42px; box-sizing: border-box; padding: 0 6px 0 12px; border-radius: 9px; border: 1px solid {{t.line}}; background: {{t.bg}}; margin-bottom: 6px">
<label for="new" style="position: absolute; left: -9999px">Start something</label>
<input id="new" type="text" placeholder="Start something new…" style="flex-grow: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: {{t.ink}}; font: 14px 'Geist', sans-serif">
<span style="font-size: 11.5px; color: {{t.muted}}; padding: 3px 7px; border-radius: 6px; background: {{t.raised}}; white-space: nowrap">agent-office ▾</span>
''' + b('Start',True,'⌘↵') + r'''
</form>
''' + sect('Jump in','2','1 2 answer') + \
  row(W,'Rail renderer','Widen the rail, or draw over the margin?', b('Widen',True,'1')+b('Draw over',False,'2'), amber=True, hl=True) + \
  row(Sh,'Answer comments #212','Run <span style="font-family: \'Geist Mono\', monospace; font-size: 12px">pnpm install --frozen-lockfile</span>?', b('Allow once',True)+b('Deny'), amber=True) + \
  '<div style="height: 6px"></div>' + sect('Review','3') + \
  row(W,'Fixing the saved-cards crash','Fix ready · 2 files · tests pass', b('Review',True), src='SE') + \
  row(P,'Metro workspace','Plan ready · 7 units', b('Read plan')) + \
  row(W,'Try canvas','Canvas vs SVG, measured', b('Compare')) + \
  '<div style="height: 6px"></div>' + sect('Your call','2') + \
  row(W,'Habit tracker','Used a default: browser notifications for reminders', b('Keep')+b('Change')) + \
  row(B,'Plan the Codex adapter','Worth starting? It moved into this cycle.', b('Start',True)+b('Not now'), src='LN') + r'''
</aside>'''
tb=r'''<div style="height: 40px; flex-shrink: 0; display: flex; align-items: center; gap: 14px; padding: 0 14px; background: {{t.panel}}; border-bottom: 1px solid {{t.line}}">
<span style="display: flex; gap: 8px"><span style="width: 12px; height: 12px; border-radius: 50%; background: #ff5f57"></span><span style="width: 12px; height: 12px; border-radius: 50%; background: #febc2e"></span><span style="width: 12px; height: 12px; border-radius: 50%; background: #28c840"></span></span>
<span style="margin-left: 14px; font-size: 13px; font-weight: 600">Agent Office</span>
<span style="font-size: 12px; color: {{t.muted}}">11 lines · 2 need you · 3 to review</span>
<span style="margin-left: auto; display: flex; gap: 16px; font-size: 12px; color: {{t.muted}}"><span>Finished today · 2</span><span>Go to chat <span style="font-family: 'Geist Mono', monospace; font-size: 11px">⌘K</span></span></span>
</div>
'''
body = r'''<div style="flex-grow: 1; min-height: 0; display: flex">
<main style="flex-grow: 1; min-width: 0; position: relative">
<svg width="1000" height="720" viewBox="0 0 860 620" role="img" aria-label="Network: every line growing out from its repository's main, with where each one is now" style="position: absolute; left: 0; top: 34px" font-family="Geist, sans-serif">
''' + svg + r'''
</svg>
<div style="position: absolute; left: 24px; bottom: 18px; display: flex; gap: 16px; font-size: 11.5px; color: {{t.muted}}">
<span><span style="font-family: 'Geist Mono', monospace">↵</span> open a line</span><span><span style="font-family: 'Geist Mono', monospace">Space</span> expand</span><span><span style="font-family: 'Geist Mono', monospace">B</span> branch from a stop</span>
<span style="display: flex; align-items: center; gap: 6px"><span style="width: 7px; height: 7px; border-radius: 2px; background: #fb923c"></span><span style="width: 7px; height: 7px; border-radius: 2px; background: #a78bfa"></span><span style="width: 7px; height: 7px; border-radius: 2px; background: #34d399"></span>came in from Sentry, GitHub, Linear</span>
</div>
</main>
''' + right + r'''
</div>
'''
H = head('Hub') + tb + body + '</div>\n</x-dc>\n' + tokens()
open(OUT+'Z5-Hub.dc.html','w').write(H)
print('ok', H.count('<div')-H.count('</div>'))
