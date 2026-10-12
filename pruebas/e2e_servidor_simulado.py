# Prueba del adaptador REAL con un Supabase simulado (rutas interceptadas)
from playwright.sync_api import sync_playwright, expect
import json, os
SP=os.path.dirname(os.path.abspath(__file__))
URL="http://localhost:8766/index.html"
BASE="https://demo.supabase.co"
db={"gastos":[],"notifs":[],"centros":[{"id":"c1","codigo":"CC-1","nombre":"Norte","activo":True}],"fotos":{}}
perfil={"id":"uid-1","nombre":"Vera Vendedora","correo":"vera@x.co","rol":"vendedor","cedula":"123456789","centro_id":"c1","ciudad":"Cali","activo":True}
vistos=[]
def manejar(route):
    req=route.request; u=req.url; m=req.method
    vistos.append(f"{m} {u.replace(BASE,'')[:70]}")
    h={"access-control-allow-origin":"*","access-control-allow-headers":"*","access-control-allow-methods":"*"}
    if m=="OPTIONS": return route.fulfill(status=204,headers=h)
    def js(d,st=200): route.fulfill(status=st,headers={**h,"content-type":"application/json"},body=json.dumps(d))
    if "/auth/v1/token" in u:
        c=json.loads(req.post_data)
        if c["password"]!="clave123": return js({"error_description":"bad"},400)
        return js({"access_token":"AT","refresh_token":"RT","expires_in":3600,"user":{"id":"uid-1"}})
    assert req.headers.get("authorization","")=="Bearer AT" or "/auth/" in u, "falta token en "+u
    if "/rpc/registrar_evento" in u: return js(None,204)
    if "/rest/v1/perfiles" in u: return js([perfil])
    if "/rest/v1/centros_costo" in u: return js(db["centros"])
    if "/rest/v1/notificaciones" in u: return js(db["notifs"])
    if "/storage/v1/object/recibos/" in u and m=="POST": db["fotos"][u]=1; return js({"Key":"ok"})
    if "/rest/v1/gastos" in u and m=="POST":
        f=json.loads(req.post_data); f=f[0] if isinstance(f,list) else f
        f.setdefault("estado","enviado"); f["vendedor_nombre"]="Vera Vendedora"; f["recibido_servidor"]="2026-10-11T20:00:00Z"
        db["gastos"]=[x for x in db["gastos"] if x["id"]!=f["id"]]+[f]
        db["notifs"].append({"id":"n1","usuario_id":"uid-1","tipo":"enviado","gasto_id":f["id"],"texto":"Enviado correctamente a contabilidad: x","creada":"2026-10-11T20:00:01Z","leida":False})
        return js([f],201)
    if "/rest/v1/gastos" in u and m=="GET": return js(db["gastos"])
    return js({"message":"no mock "+u},404)
with sync_playwright() as p:
    b=p.chromium.launch()
    ctx=b.new_context(viewport={"width":390,"height":800},service_workers="block",locale="es-CO",timezone_id="America/Bogota")
    ctx.route("**/js/config.js",lambda r: r.fulfill(content_type="application/javascript",body=f'const CONFIG={{supabaseUrl:"{BASE}",supabaseAnonKey:"anon-key",refrescoMs:60000}};'))
    ctx.route("https://demo.supabase.co/**",manejar)
    pg=ctx.new_page(); errs=[]
    pg.on("console",lambda m: errs.append(m.text) if m.type=="error" else None)
    pg.on("pageerror",lambda e: errs.append("PAGEERR "+str(e)+" "+str(getattr(e,"stack",""))[:600]))
    pg.goto(URL); pg.wait_for_selector("#vista-login:not([hidden])")
    print("aviso modo prueba oculto en modo real:",pg.locator("#login-modo").is_hidden())
    pg.fill("#login-correo","vera@x.co"); pg.fill("#login-clave","mala"); pg.click("#login-enviar")
    expect(pg.locator("#login-error")).to_contain_text("incorrectos")
    pg.fill("#login-clave","clave123"); pg.click("#login-enviar"); pg.wait_for_selector("#form-gasto")
    pg.select_option("#f-categoria","transporte"); pg.fill("#f-monto","15000"); pg.fill("#f-desc","Taxi al cliente")
    pg.click("#btn-enviar"); 
    pg.wait_for_selector(".aviso:has-text('Enviado correctamente a contabilidad')")
    expect(pg.locator(".gasto:has-text('Taxi al cliente')")).to_have_count(1)
    print("gasto guardado en servidor simulado:",len(db["gastos"]), "estado:",db["gastos"][0]["estado"])
    print("campos servidor no enviados (alta_por):", "alta_por" not in db["gastos"][0])
    print("\\n".join(vistos[:12]))
    print("ERRS",errs)
    b.close()
