# Prueba de punta a punta (navegador real) de ViaticoYa v2: registro, aprobación, roles, contraseñas, actividad, ubicación automática.
# Uso: servir la carpeta (python3 -m http.server 8766) y correr: python3 pruebas/e2e_v2.py
from playwright.sync_api import sync_playwright, expect
import os
URL="http://localhost:8766/index.html"
SP=os.path.dirname(os.path.abspath(__file__))
fallos=[]
def ok(c,msg):
    print(("OK   " if c else "FALLA"),msg)
    if not c: fallos.append(msg)
with sync_playwright() as p:
    b=p.chromium.launch()
    ctx=b.new_context(viewport={"width":390,"height":800},service_workers="block",permissions=["geolocation"],geolocation={"latitude":6.2442,"longitude":-75.5812,"accuracy":25},locale="es-CO",timezone_id="America/Bogota",accept_downloads=True)
    ctx.route("**/js/config.js",lambda r: r.fulfill(content_type="application/javascript",body='const CONFIG={supabaseUrl:"",supabaseAnonKey:"",refrescoMs:15000,aprobarNuevos:true,pruebas:true};'))
    pg=ctx.new_page(); errs=[]
    pg.on("console",lambda m: errs.append(m.text) if m.type=="error" else None)
    pg.on("pageerror",lambda e: errs.append("PAGEERR "+str(e)))
    def login(correo,clave):
        pg.fill("#login-correo",correo); pg.fill("#login-clave",clave); pg.click("#login-enviar")
    def salir():
        pg.click("#btn-perfil"); pg.click("#btn-salir"); pg.wait_for_selector("#vista-login:not([hidden])")
    pg.goto(URL); pg.wait_for_selector("#vista-login:not([hidden])")
    pg.screenshot(path="/tmp/vy_login.png")
    txt=pg.inner_text("#vista-login")
    ok("@" not in txt and "demo1234" not in txt and "superusuario" not in txt.lower(),"el inicio NO muestra correos, claves ni datos de ningún superusuario")
    ok(pg.locator(".demo-perfil").count()==0,"no hay botones de usuarios de demostración")
    ok(pg.locator("#tab-crear").count()==1,"hay pestaña Crear cuenta")
    login("carlos@viaticoya.demo","mala"); ok("incorrectos" in pg.inner_text("#login-error"),"clave mala rechazada")
    # ---- crear cuenta nueva
    pg.click("#tab-crear")
    pg.fill("#reg-nombre","Sofía Gómez"); pg.fill("#reg-correo","sofia@ejemplo.com"); pg.fill("#reg-cedula","1020304050"); pg.fill("#reg-ciudad","Cali")
    pg.fill("#reg-clave","abc123"); pg.fill("#reg-clave2","abc124"); pg.click("#reg-enviar")
    ok("no coinciden" in pg.inner_text("#reg-msg"),"contraseñas distintas rechazadas")
    pg.fill("#reg-clave2","abc123"); pg.click("#reg-enviar")
    ok("autorices" in pg.inner_text("#reg-msg").lower() or "autorizar" in pg.inner_text("#reg-msg").lower(),"exige autorizar datos")
    pg.check("#reg-acepto"); pg.click("#reg-enviar")
    pg.wait_for_selector("#login-espera:not([hidden])")
    ok("aprobarla" in pg.inner_text("#login-espera"),"cuenta creada: pantalla de espera por aprobación")
    pg.screenshot(path="/tmp/vy_espera.png"); pg.click("#espera-volver")
    pg.click("#tab-entrar") if pg.locator("#tab-entrar").is_visible() else None
    login("sofia@ejemplo.com","abc123"); pg.wait_for_selector("#login-error:not([hidden])")
    ok("pendiente" in pg.inner_text("#login-error").lower(),"cuenta pendiente no puede ingresar")
    # ---- superusuario (demo)
    login("admin@viaticoya.demo","demo1234"); pg.wait_for_selector("#vista-app:not([hidden])")
    ok(pg.locator('#nav a:has-text("Admin") .insignia').count()==1,"insignia de cuentas por aprobar en Admin")
    pg.click('#nav a:has-text("Admin")'); pg.wait_for_selector("text=esperan tu aprobación")
    ok(pg.locator("#btn-nuevo-usuario").count()==0,"no existe 'Nuevo usuario' (solo se crean desde Crear cuenta)")
    pg.screenshot(path="/tmp/vy_admin_usuarios.png")
    pg.click('[data-aprobar]'); pg.wait_for_selector(".aviso:has-text('ya puede ingresar')")
    ok(pg.locator("[data-aprobar]").count()==0,"cuenta aprobada")
    # rol auxiliar otorgado por super
    pg.click('.gasto:has-text("Sofía Gómez")'); pg.select_option("#a-rol","auxiliar"); pg.click('#form-admin button[type=submit]')
    pg.wait_for_selector(".aviso:has-text('Usuario guardado')"); ok(True,"super otorga rol de auxiliar contable")
    # cambiar contraseña de otro usuario
    pg.click('[data-clave="u-carlos"]'); pg.click("#btn-generar-clave"); nueva=pg.input_value("#clave-nueva")
    ok(len(nueva)>=10,"se genera contraseña segura"); pg.click('#form-clave button[type=submit]')
    pg.wait_for_selector(".aviso:has-text('Contraseña de Carlos')"); ok(True,"super cambia contraseña de otro usuario")
    # actividad
    pg.click('[data-actividad="u-carlos"]'); pg.wait_for_selector("#tabla-actividad")
    pg.click('a[href="#/admin/actividad"]'); pg.select_option("#act-usuario",""); pg.select_option("#act-accion","clave_cambiada")
    pg.wait_for_selector("#tabla-actividad td:has-text('Cambio de contraseña')")
    fila=pg.inner_text("#tabla-actividad tbody tr")
    ok("Linux" in fila or "Chrome" in fila,"la actividad muestra el equipo: "+fila.replace("\n"," | ")[:120])
    pg.screenshot(path="/tmp/vy_admin_actividad.png")
    salir()
    # ---- carlos ya no entra con la anterior y sí con la nueva
    login("carlos@viaticoya.demo","demo1234"); pg.wait_for_selector("#login-error:not([hidden])"); ok("incorrectos" in pg.inner_text("#login-error"),"contraseña anterior ya no sirve")
    pg.fill("#login-clave",nueva); pg.click("#login-enviar"); pg.wait_for_selector("#form-gasto")
    ok(True,"vendedor ingresa con la contraseña nueva")
    # ---- ubicación automática + predicción
    pg.wait_for_selector("#chip-ubi:has-text('Ubicación')",timeout=8000); ok(True,"ubicación tomada automáticamente al abrir el formulario")
    ok(pg.input_value("#f-ciudad") in ("Medellín","Envigado"),"ciudad sugerida por GPS: "+pg.input_value("#f-ciudad"))
    pg.screenshot(path="/tmp/vy_registrar.png")
    # cambiar mi contraseña
    pg.click("#btn-perfil"); pg.click("#btn-mi-clave"); pg.fill("#clave-actual","incorrecta"); pg.fill("#clave-nueva","nueva123"); pg.fill("#clave-nueva2","nueva123")
    pg.click('#form-clave button[type=submit]'); pg.wait_for_selector("#clave-error:not([hidden])"); ok("actual" in pg.inner_text("#clave-error"),"cambiar mi clave exige la actual")
    pg.fill("#clave-actual",nueva); pg.click('#form-clave button[type=submit]'); pg.wait_for_selector(".aviso:has-text('Contraseña actualizada')"); ok(True,"vendedor cambia su propia contraseña")
    salir()
    # ---- auxiliar: no modifica, ve alertas, exporta
    login("contabilidad@viaticoya.demo","demo1234"); pg.wait_for_selector("#nav")
    ok(pg.locator('#nav a:has-text("Admin")').count()==0,"auxiliar no ve Admin")
    pg.click('#nav a:has-text("Por dar de alta")'); pg.wait_for_selector(".gasto")
    ok(pg.locator("#proyeccion").count()==0,"(proyección solo en tablero)")
    pg.screenshot(path="/tmp/vy_revisar.png")
    pg.click('#nav a:has-text("Tablero")'); pg.wait_for_selector("#proyeccion"); ok(True,"tablero con proyección del mes")
    pg.click('#nav a:has-text("Exportar")')
    with pg.expect_download() as d: pg.click("#btn-excel")
    ok(d.value.suggested_filename.endswith(".xlsx"),"auxiliar exporta Excel")
    salir()
    # ---- vendedor no entra a admin
    login("laura@viaticoya.demo","demo1234"); pg.wait_for_selector("#nav"); pg.goto(URL+"#/admin"); pg.wait_for_selector("#nav")
    ok("admin" not in pg.url,"vendedor no accede a Admin por URL")
    b.close()
ok(not errs,"sin errores de consola: "+str(errs[:3]))
print("\nFALLAS:",len(fallos)); raise SystemExit(1 if fallos else 0)
