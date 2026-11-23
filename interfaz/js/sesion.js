/**
 * sesion.js — Ingreso con PIN, usuarios, autorizaciones y relevo de caja.
 *
 *  - Al abrir (y al "Cambiar de usuario") se elige el perfil y se pone el PIN.
 *    La primera vez, la persona crea su propio PIN.
 *  - Si no hay usuarios (primera vez con la versión 5), se crea el
 *    administrador y se muestra el código de recuperación.
 *  - Lo que un rol no puede hacer lo puede autorizar alguien con permiso
 *    poniendo su PIN (ver `intentar` en utilidades.js).
 *  - Relevo de caja: el que sale cuenta el efectivo (sin ver lo esperado) y
 *    el que entra lo recibe con su PIN; la caja no se cierra.
 */
const Sesion = { usuario: null };
const puedo = (permiso) => !!(Sesion.usuario && Sesion.usuario.permisos && Sesion.usuario.permisos.includes(permiso));
const iniciales = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

/* ---------------- Pantalla de ingreso ---------------- */
async function mostrarIngreso() {
  const raiz = $('#ingreso');
  while (hayModal()) cerrarModal();
  $('#app').hidden = true;
  raiz.hidden = false;
  raiz.innerHTML = '';
  let estado;
  try { estado = await BESALU.sesion.estado(); } catch (e) { raiz.appendChild(el('p', { class: 'mini', text: 'No se pudo leer los usuarios: ' + e.message })); return; }
  // Si la pantalla se recargó con alguien adentro, sigue esa misma sesión (el sistema la guarda hasta cerrar la app)
  if (estado.actual) { raiz.hidden = true; return entrar(estado.actual, { silencioso: true }); }
  const tarjeta = el('div', { class: 'ingreso-card' });
  const neg = String(estado.negocio || '');
  const mismoNombre = neg.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '') === 'besalumercat';
  raiz.append(el('div', { class: 'ingreso-marca' }, [marcaBesalu(), neg && !mismoNombre ? el('div', { class: 'mini', text: neg }) : null]), tarjeta);
  if (!estado.hayUsuarios) return pasoPrimerAdmin(tarjeta);
  pasoElegirUsuario(tarjeta, estado.usuarios);
}

/** Logo: "Besalú" con "MERCAT" del mismo ancho, centrado (es el mismo del ícono de la app). */
function marcaBesalu() {
  const m = el('div', { class: 'marca marca--grande' }, [el('span', { class: 'm1', text: 'Besalú' }), el('span', { class: 'm2' }, el('span', { class: 't', text: 'MERCAT' }))]);
  requestAnimationFrame(() => ajustarMarcas(m.parentNode || document));
  return m;
}

/**
 * Deja "MERCAT" exactamente del ancho de "Besalú": mide las dos palabras con la
 * fuente real y reparte el espacio entre las letras (con dos líneas finas a los lados).
 */
function ajustarMarcas(raiz) {
  const ctx = (ajustarMarcas.ctx = ajustarMarcas.ctx || document.createElement('canvas').getContext('2d'));
  for (const m of (raiz || document).querySelectorAll('.marca')) {
    const m1 = m.querySelector('.m1'), m2 = m.querySelector('.m2'), t = m.querySelector('.m2 .t');
    if (!m1 || !t) continue;
    const e1 = getComputedStyle(m1), e2 = getComputedStyle(m2);
    ctx.font = e1.fontWeight + ' ' + e1.fontSize + ' ' + e1.fontFamily;
    const ancho = ctx.measureText(m1.textContent).width;
    ctx.font = e2.fontWeight + ' ' + e2.fontSize + ' ' + e2.fontFamily;
    const texto = t.textContent, propio = ctx.measureText(texto).width;
    const linea = Math.round(parseFloat(e2.fontSize) * 1.3), hueco = parseFloat(e2.fontSize) * 0.55;
    const espacio = Math.max(0, (ancho - propio - 2 * (linea + hueco)) / (texto.length - 1));
    t.style.letterSpacing = espacio + 'px';
    t.style.marginRight = -espacio + 'px';   // sin el espacio después de la última letra
    m2.style.setProperty('--linea', linea + 'px');
    m2.style.gap = hueco + 'px';
  }
}
if (document.fonts) document.fonts.ready.then(() => ajustarMarcas(document));

function pasoElegirUsuario(tarjeta, lista) {
  tarjeta.innerHTML = '';
  tarjeta.append(el('h2', { text: '¿Quién va a usar la caja?' }),
    el('div', { class: 'perfiles' }, lista.map((u) => el('button', { class: 'perfil', 'data-usuario': String(u.id), onclick: () => (u.tiene_pin ? pasoPin(tarjeta, u, lista) : pasoCrearPin(tarjeta, u, lista)) }, [
      el('span', { class: 'avatar avatar--' + u.rol, text: iniciales(u.nombre) }), el('b', { text: u.nombre }),
      el('span', { class: 'mini', text: u.rol_nombre + (u.tiene_pin ? '' : ' · crear PIN') })]))),
    lista.some((u) => u.rol === 'admin') ? el('button', { class: 'link-btn', onclick: () => pasoRecuperar(tarjeta, lista) }, '¿Olvidó el PIN de administrador?') : null);
  const primero = tarjeta.querySelector('.perfil');
  if (primero) primero.focus();
}

/** Campo de PIN con puntos y teclado numérico en pantalla (también funciona con el teclado). */
function campoPin(alCompletar, { largoAuto = 0 } = {}) {
  const input = el('input', { type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: 8, class: 'pin-input', 'aria-label': 'PIN' });
  const puntos = el('div', { class: 'pin-puntos' });
  const pintar = () => { puntos.innerHTML = ''; for (let i = 0; i < Math.max(4, input.value.length); i++) puntos.appendChild(el('i', { class: i < input.value.length ? 'lleno' : '' })); };
  input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 8); pintar(); if (largoAuto && input.value.length === largoAuto) alCompletar(input.value); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); alCompletar(input.value); } });
  const tecla = (t, accion) => el('button', { class: 'tecla', type: 'button', tabindex: -1, onclick: () => { accion(); input.focus(); } }, t);
  const teclado = el('div', { class: 'teclado' }, [
    ...'123456789'.split('').map((n) => tecla(n, () => { if (input.value.length < 8) { input.value += n; input.dispatchEvent(new Event('input')); } })),
    tecla('⌫', () => { input.value = input.value.slice(0, -1); pintar(); }),
    tecla('0', () => { if (input.value.length < 8) { input.value += '0'; input.dispatchEvent(new Event('input')); } }),
    tecla('OK', () => alCompletar(input.value))]);
  pintar();
  return { nodo: el('div', { class: 'pin' }, [puntos, input, teclado]), input, limpiar: () => { input.value = ''; pintar(); } };
}

function encabezadoPerfil(u, volver) {
  return el('div', { class: 'perfil-sel' }, [
    volver ? el('button', { class: 'icon-btn', title: 'Elegir otro', onclick: volver }, '←') : null,
    el('span', { class: 'avatar avatar--' + u.rol, text: iniciales(u.nombre) }),
    el('div', {}, [el('b', { text: u.nombre }), el('div', { class: 'mini', text: u.rol_nombre })])]);
}

function pasoPin(tarjeta, u, lista) {
  tarjeta.innerHTML = '';
  const error = el('div', { class: 'pin-error' });
  let ocupado = false;
  const pin = campoPin(async (valor) => {
    if (ocupado || !valor) return;
    ocupado = true; error.textContent = '';
    try { const usuario = await BESALU.sesion.ingresar(u.id, valor); await entrar(usuario); }
    catch (e) { error.textContent = limpiarMensaje(e); pin.limpiar(); tarjeta.classList.add('sacudir'); setTimeout(() => tarjeta.classList.remove('sacudir'), 400); }
    finally { ocupado = false; }
  });
  tarjeta.append(encabezadoPerfil(u, () => pasoElegirUsuario(tarjeta, lista)), el('h2', { text: 'Ponga su PIN' }), pin.nodo, error);
  setTimeout(() => pin.input.focus(), 30);
}

function pasoCrearPin(tarjeta, u, lista) {
  tarjeta.innerHTML = '';
  const error = el('div', { class: 'pin-error' });
  let primero = null;
  const titulo = el('h2', { text: 'Cree su PIN' });
  const ayuda = el('div', { class: 'mini', style: 'text-align:center;margin:-6px 0 10px', text: 'De 4 a 8 números. Solo usted lo va a saber: con él entra y se firma lo que hace.' });
  const pin = campoPin(async (valor) => {
    error.textContent = '';
    if (!primero) {
      if (valor.length < 4) { error.textContent = 'El PIN es de 4 a 8 números'; return; }
      primero = valor; pin.limpiar(); titulo.textContent = 'Repita su PIN'; ayuda.textContent = 'Para confirmar que quedó bien.';
      return;
    }
    if (valor !== primero) { error.textContent = 'No coincide: empiece de nuevo'; primero = null; pin.limpiar(); titulo.textContent = 'Cree su PIN'; return; }
    try { const usuario = await BESALU.sesion.crearMiPin(u.id, valor); toast('PIN creado', 'ok', 'Desde ahora entra con él'); await entrar(usuario); }
    catch (e) { error.textContent = limpiarMensaje(e); primero = null; pin.limpiar(); titulo.textContent = 'Cree su PIN'; }
  });
  tarjeta.append(encabezadoPerfil(u, () => pasoElegirUsuario(tarjeta, lista)), titulo, ayuda, pin.nodo, error);
  setTimeout(() => pin.input.focus(), 30);
}

/** Primera vez con usuarios: se crea el administrador. */
function pasoPrimerAdmin(tarjeta) {
  tarjeta.innerHTML = '';
  const nombre = el('input', { value: 'Administración', maxlength: 60 });
  const correo = el('input', { type: 'email', placeholder: 'Opcional' });
  const pin1 = el('input', { type: 'password', inputmode: 'numeric', maxlength: 8, placeholder: '4 a 8 números' });
  const pin2 = el('input', { type: 'password', inputmode: 'numeric', maxlength: 8 });
  const crear = async (e) => {
    if (pin1.value !== pin2.value) { toast('Los PIN no coinciden', 'err'); pin2.focus(); return; }
    const b = e && e.currentTarget; if (b) b.disabled = true;
    try {
      const r = await BESALU.sesion.crearPrimerAdmin({ nombre: nombre.value, correo: correo.value, pin: pin1.value });
      mostrarCodigoRecuperacion(r.codigoRecuperacion, () => entrar(r.usuario));
    } catch (err) { toast('No se pudo crear', 'err', limpiarMensaje(err)); }
    finally { if (b) b.disabled = false; }
  };
  pin2.addEventListener('keydown', (e) => { if (e.key === 'Enter') crear(); });
  tarjeta.append(el('h2', { text: 'Bienvenido a la versión 5' }),
    el('div', { class: 'mini', style: 'margin-bottom:14px', text: 'Ahora cada persona entra con su usuario y su PIN, y queda registrado quién hizo cada venta y cada movimiento. Empiece creando el perfil de administrador; después, en Ajustes → Usuarios, cree los de los vendedores.' }),
    campo('Nombre del perfil', nombre), campo('Correo', correo), el('div', { class: 'g2' }, [campo('PIN del administrador', pin1), campo('Repita el PIN', pin2)]),
    el('button', { class: 'btn btn--accent btn--block btn--lg', style: 'margin-top:8px', onclick: crear }, 'Crear administrador y entrar'));
  setTimeout(() => nombre.select(), 30);
}

/** El código para recuperar el acceso de administrador: se muestra una vez. */
function mostrarCodigoRecuperacion(codigo, despues) {
  abrirModal(el('div', { class: 'modal narrow', 'data-codigo-recuperacion': '' }, [
    el('h2', { text: 'Código de recuperación' }),
    el('div', { class: 'mini', text: 'Si se olvida el PIN de administrador, con este código se pone uno nuevo. Anótelo o imprímalo y guárdelo en un lugar seguro: no se vuelve a mostrar.' }),
    el('div', { class: 'codigo-rec', text: codigo }),
    el('div', { class: 'modal-acc' }, [
      el('button', { class: 'btn btn--ghost', onclick: () => imprimir(el('div', { class: 'ticket' }, [el('div', { class: 'tc', style: 'font-weight:800', text: 'BESALÚ MERCAT · CÓDIGO DE RECUPERACIÓN' }),
        el('hr'), el('div', { class: 'tc', style: 'font-size:16px;font-weight:800;letter-spacing:.1em', text: codigo }), el('hr'),
        el('div', { class: 'tc small', text: 'Sirve para poner un PIN nuevo de administrador. Guárdelo bajo llave.' })])) }, [icon('printer', 16), 'Imprimir']),
      el('button', { class: 'btn btn--accent', onclick: () => { cerrarModal(); despues(); } }, 'Ya lo guardé')])
  ]));
}

function pasoRecuperar(tarjeta, lista) {
  tarjeta.innerHTML = '';
  const admins = lista.filter((u) => u.rol === 'admin');
  const quien = selector(admins.map((u) => [u.id, u.nombre]), admins[0] && admins[0].id);
  const codigo = el('input', { placeholder: 'XXXX-XXXX-XXXX', autocomplete: 'off', style: 'text-transform:uppercase;letter-spacing:.08em' });
  const pin1 = el('input', { type: 'password', inputmode: 'numeric', maxlength: 8 }), pin2 = el('input', { type: 'password', inputmode: 'numeric', maxlength: 8 });
  const listo = async () => {
    if (pin1.value !== pin2.value) { toast('Los PIN no coinciden', 'err'); return; }
    try {
      const r = await BESALU.sesion.recuperar(codigo.value, Number(quien.value), pin1.value);
      mostrarCodigoRecuperacion(r.codigoRecuperacion, () => { toast('PIN cambiado', 'ok', 'Ingrese con el PIN nuevo'); mostrarIngreso(); });
    } catch (e) { toast('No se pudo', 'err', limpiarMensaje(e)); }
  };
  tarjeta.append(el('h2', { text: 'Recuperar el acceso' }),
    el('div', { class: 'mini', style: 'margin-bottom:12px', text: 'Con el código de recuperación que se mostró al crear el administrador. Al usarlo se genera uno nuevo.' }),
    campo('Administrador', quien), campo('Código de recuperación', codigo), el('div', { class: 'g2' }, [campo('PIN nuevo', pin1), campo('Repita el PIN', pin2)]),
    el('div', { class: 'modal-acc' }, [el('button', { class: 'btn btn--ghost', onclick: () => pasoElegirUsuario(tarjeta, lista) }, 'Volver'),
      el('button', { class: 'btn btn--accent', onclick: listo }, 'Cambiar PIN')]));
}

/** Ya adentro: pinta la app según los permisos de la persona. */
async function entrar(usuario, { silencioso = false } = {}) {
  Sesion.usuario = usuario;
  $('#ingreso').hidden = true;
  await App.reiniciarEstado();
  $('#app').hidden = false;
  pintarUsuario();
  actualizarIndicadorCaja();
  // Sin datos del negocio, el administrador empieza en Ajustes
  if (!App.ajustes.cedula && puedo('ajustes')) App.vista = 'ajustes';
  const permitida = PANTALLAS.find((p) => p.v === App.vista && (!p.permiso || puedo(p.permiso)));
  go(permitida ? permitida.v : (PANTALLAS.find((p) => !p.permiso || puedo(p.permiso)) || PANTALLAS[0]).v);
  if (!App.ajustes.cedula && puedo('ajustes') && !silencioso) toast('Complete los datos del negocio', 'ok', 'La cédula es necesaria para emitir comprobantes');
  if (App.integridad && !App.integridad.ok) toast('Revise la integridad de los datos', 'err', App.integridad.problemas[0]);
  if (!silencioso) toast('Hola, ' + usuario.nombre, 'ok', usuario.rol_nombre);
  if (BESALU.lista) requestAnimationFrame(() => BESALU.lista());
}

async function salir() {
  if (typeof Caja !== 'undefined' && Caja.carrito.length && !(await confirmar('Cambiar de usuario', 'Hay una venta sin cobrar en la caja: se va a descartar.', { aceptar: 'Descartar y salir' }))) return;
  await BESALU.sesion.salir().catch(() => {});
  Sesion.usuario = null;
  if (typeof Caja !== 'undefined') { Caja.carrito = []; Caja.cliente = null; Caja.hecho = null; }
  mostrarIngreso();
}

/* ---------------- Usuario arriba a la derecha ---------------- */
function pintarUsuario() {
  const b = $('#userpill');
  if (!b || !Sesion.usuario) return;
  const u = Sesion.usuario;
  b.innerHTML = '';
  b.append(el('span', { class: 'avatar avatar--' + u.rol, text: iniciales(u.nombre) }), el('span', { class: 'un', text: u.nombre }));
  b.title = u.nombre + ' · ' + u.rol_nombre;
  b.onclick = menuUsuario;
}

function menuUsuario() {
  const u = Sesion.usuario;
  const opcion = (ic, texto, accion, extra) => el('button', { class: 'menu-op', onclick: () => { cerrarModal(); accion(); } }, [icon(ic, 17), el('span', { text: texto }), extra || null]);
  abrirModal(el('div', { class: 'modal narrow menu-usuario' }, [
    el('div', { class: 'perfil-sel' }, [el('span', { class: 'avatar avatar--' + u.rol, text: iniciales(u.nombre) }), el('div', {}, [el('b', { text: u.nombre }), el('div', { class: 'mini', text: u.rol_nombre + (u.correo ? ' · ' + u.correo : '') })])]),
    App.turno && puedo('relevo') ? opcion('wallet', 'Relevo de caja', relevoDeCaja, el('span', { class: 'mini', text: 'Entregar la caja a otro sin cerrarla' })) : null,
    opcion('user', 'Cambiar de usuario', salir),
    opcion('lock', 'Cambiar mi PIN', cambiarMiPin)
  ]));
}

function cambiarMiPin() {
  const actual = el('input', { type: 'password', inputmode: 'numeric', maxlength: 8 });
  const p1 = el('input', { type: 'password', inputmode: 'numeric', maxlength: 8 }), p2 = el('input', { type: 'password', inputmode: 'numeric', maxlength: 8 });
  const guardar = async () => {
    if (p1.value !== p2.value) { toast('Los PIN nuevos no coinciden', 'err'); return; }
    if (await intentar(() => BESALU.sesion.cambiarMiPin(actual.value, p1.value), 'No se cambió el PIN')) { cerrarModal(); toast('PIN cambiado'); }
  };
  p2.addEventListener('keydown', (e) => { if (e.key === 'Enter') guardar(); });
  abrirModal(el('div', { class: 'modal narrow' }, [el('h2', { text: 'Cambiar mi PIN' }),
    campo('PIN actual', actual), el('div', { class: 'g2' }, [campo('PIN nuevo', p1), campo('Repita el PIN nuevo', p2)]),
    el('div', { class: 'modal-acc' }, [el('button', { class: 'btn btn--ghost', onclick: cerrarModal }, 'Cancelar'), el('button', { class: 'btn btn--accent', onclick: guardar }, 'Cambiar')])]));
}

/* ---------------- Autorización (PIN de alguien con permiso) ---------------- */
/** @returns {Promise<boolean>} true si alguien con permiso autorizó la acción */
function pedirAutorizacion(permiso, motivo) {
  return new Promise((resolver) => {
    const error = el('div', { class: 'pin-error' });
    let listo = false;
    const fin = (v) => { if (listo) return; listo = true; cerrarModal(); resolver(v); };
    const pin = campoPin(async (valor) => {
      if (!valor) return;
      try { const r = await BESALU.sesion.autorizar(permiso, valor); toast('Autorizó ' + r.autorizo); fin(true); }
      catch (e) { error.textContent = limpiarMensaje(e); pin.limpiar(); }
    });
    abrirModal(el('div', { class: 'modal narrow autorizacion', 'data-autorizacion': permiso }, [
      el('div', { class: 'card-t' }, [el('h2', { text: 'Autorización' }), el('button', { class: 'icon-btn', onclick: () => fin(false) }, icon('x', 18))]),
      el('div', { class: 'mini', style: 'text-align:center;margin-bottom:10px', text: motivo + '. Un encargado o el administrador pone su PIN para autorizarlo (solo esta vez).' }),
      pin.nodo, error]));
    setTimeout(() => pin.input.focus(), 30);
  });
}

/* ---------------- Relevo de caja ---------------- */
async function relevoDeCaja() {
  const [tramo, estado] = await Promise.all([intentar(() => BESALU.caja.tramo()), intentar(() => BESALU.sesion.estado())]);
  if (!tramo) { toast('La caja no está abierta', 'err'); return; }
  const otros = estado.usuarios.filter((u) => u.id !== tramo.usuario_id);
  if (!otros.length) { toast('No hay otro usuario para recibir la caja', 'err', 'Créelo en Ajustes → Usuarios'); return; }
  let entrante = null;
  const contado = el('input', { inputmode: 'decimal', placeholder: '0', class: 'monto-grande' });
  const lista = el('div', { class: 'perfiles perfiles--chicos' }, otros.map((u) => el('button', { class: 'perfil', 'data-usuario': String(u.id), onclick: (e) => {
    entrante = u; lista.querySelectorAll('.perfil').forEach((b) => b.classList.toggle('sel', b === e.currentTarget)); pinRecibe.input.focus();
  } }, [el('span', { class: 'avatar avatar--' + u.rol, text: iniciales(u.nombre) }), el('b', { text: u.nombre })])));
  const error = el('div', { class: 'pin-error' });
  const pinRecibe = campoPin(async (valor) => {
    error.textContent = '';
    if (!String(contado.value).trim()) { error.textContent = 'Primero cuente el efectivo'; contado.focus(); return; }
    if (!entrante) { error.textContent = 'Elija quién recibe la caja'; return; }
    if (!entrante.tiene_pin) { error.textContent = entrante.nombre + ' todavía no tiene PIN: que ingrese una vez para crearlo'; return; }
    try {
      const r = await BESALU.caja.relevo(aCentimos(contado.value), entrante.id, valor);
      cerrarModal();
      Sesion.usuario = r.usuario;
      pintarUsuario(); pintarNavegacion();
      const d = r.saliente.tramo.diferencia;
      await confirmar('Relevo hecho', r.saliente.tramo.usuario_nombre + ' entregó ' + money(r.saliente.tramo.contado) + ' (se esperaban ' + money(r.saliente.tramo.esperado) + ').\n' +
        'Diferencia: ' + (d > 0 ? '+' : '') + money(d) + '\n\nAhora la caja es de ' + r.usuario.nombre + ', que empieza con ' + money(r.saliente.tramo.contado) + '.', { aceptar: 'Listo' });
      imprimir(armarRelevo(r));
      go(App.vista);
    } catch (e) { error.textContent = limpiarMensaje(e); pinRecibe.limpiar(); }
  });
  abrirModal(el('div', { class: 'modal relevo', 'data-relevo': '' }, [
    el('div', { class: 'card-t' }, [el('h2', { text: 'Relevo de caja' }), el('button', { class: 'icon-btn', onclick: cerrarModal }, icon('x', 18))]),
    el('div', { class: 'paso' }, [el('span', { class: 'n', text: '1' }), el('div', {}, [el('b', { text: tramo.usuario_nombre + ' entrega: cuente el efectivo de la caja' }),
      el('div', { class: 'mini', text: 'Todo el efectivo, incluido el fondo. El sistema compara con lo esperado después.' })])]),
    campo('Efectivo contado (₡)', contado),
    el('div', { class: 'paso' }, [el('span', { class: 'n', text: '2' }), el('div', {}, [el('b', { text: 'Quién recibe la caja' }), el('div', { class: 'mini', text: 'Elija su perfil y ponga su PIN: empieza con lo contado.' })])]),
    lista, pinRecibe.nodo, error
  ]));
  setTimeout(() => contado.focus(), 30);
}

/** Quita las marcas internas (§permiso:…§) de un mensaje de error. */
function limpiarMensaje(e) {
  return String((e && e.message) || e).replace(/^Error invoking remote method '[^']*': (Error: )?/, '').replace(/^§[^§]*§/, '');
}
