from playwright.sync_api import sync_playwright, expect
URL="http://localhost:8766/index.html"
with sync_playwright() as p:
    b=p.chromium.launch()
    ctx=b.new_context(viewport={"width":390,"height":800},permissions=["geolocation"],geolocation={"latitude":4.711,"longitude":-74.07,"accuracy":40},locale="es-CO",timezone_id="America/Bogota",color_scheme="dark")
    ctx.route("**/js/config.js",lambda r: r.fulfill(content_type="application/javascript",body='const CONFIG={supabaseUrl:"",supabaseAnonKey:"",refrescoMs:15000,aprobarNuevos:true,pruebas:true};'))
    pg=ctx.new_page(); errs=[]
    pg.on("console",lambda m: errs.append(m.text) if m.type=="error" else None)
    pg.goto(URL); pg.wait_for_selector("#vista-login:not([hidden])")
    pg.evaluate("navigator.serviceWorker.ready.then(()=>1)")
    pg.wait_for_timeout(1500)
    print("controller:",pg.evaluate("!!navigator.serviceWorker.controller"))
    pg.reload(); pg.wait_for_timeout(800)
    print("controller tras recarga:",pg.evaluate("!!navigator.serviceWorker.controller"))
    pg.fill("#login-correo","carlos@viaticoya.demo"); pg.fill("#login-clave","demo1234"); pg.click("#login-enviar"); pg.wait_for_selector("#form-gasto")
    pg.wait_for_timeout(800)
    ctx.set_offline(True)
    pg.reload(); pg.wait_for_selector("#form-gasto",timeout=8000)
    print("reabre sin internet con sesión: OK, chip:",pg.inner_text("#chip-red"))
    print("centros en caché:",pg.locator("#f-centro option").count())
    pg.screenshot(path="vy_offline_dark.png")
    pg.click('#nav a[href="#/mis-gastos"]'); pg.wait_for_selector(".gasto")
    print("gastos en caché:",pg.locator(".gasto").count())
    # desktop
    pg.set_viewport_size({"width":1280,"height":800})
    pg.screenshot(path="vy_desktop.png")
    print("errs",errs)
    b.close()
