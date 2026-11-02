/* Calculadora IPv4: conecta la interfaz con la API del backend.
 *
 * El backend devuelve la tabla ya redactada (etiquetas, "No aplica…",
 * miles con punto); aquí solo se pinta. Frontend y API comparten origen
 * (Nginx en producción, scripts/servidor_local.py en desarrollo), así que
 * las rutas son relativas a la raíz y no hace falta CORS.
 */
(function () {
  "use strict";

  var API = "/api";

  var ICONO_ERROR =
    '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill="none" ' +
    'stroke="#A4261C" stroke-width="1.6" stroke-linecap="round">' +
    '<circle cx="9" cy="9" r="7.4"/><path d="M9 5v4.6M9 12.4v.1"/></svg>';

  var TEXTO_VALIDACION =
    "Se validan cuatro octetos enteros de 0 a 255, prefijos de 0 a 32 y máscaras " +
    "con los unos contiguos. Cualquier otra entrada se rechaza con un mensaje que " +
    "indica qué campo corregir.";

  // Nombre de cada campo en la frase "Corrige … y vuelve a calcular."
  var NOMBRE_CAMPO = {
    entrada: "la entrada",
    direccion: "la dirección",
    mascara: "la máscara",
  };

  var formulario = document.getElementById("formulario");
  var botonesForma = formulario.querySelectorAll(".seg button");
  var bloques = { a: document.getElementById("forma-a"), b: document.getElementById("forma-b") };
  var campos = {
    entrada: document.getElementById("in-entrada"),
    direccion: document.getElementById("in-direccion"),
    mascara: document.getElementById("in-mascara"),
  };
  var listaCasos = document.getElementById("casos");
  var pistaCasos = document.getElementById("casos-hint");
  var seccionResultado = document.getElementById("resultado");

  var forma = "a";
  var ultimoResultado = null; // última respuesta 200, para "Copiar" y al cambiar de formato
  var peticionEnCurso = null; // AbortController de la petición en vuelo

  // -------------------------------------------------------------------------
  // Utilidades de DOM (textContent siempre: nada de la API pasa por innerHTML)
  // -------------------------------------------------------------------------

  function el(etiqueta, atributos) {
    var nodo = document.createElement(etiqueta);
    Object.keys(atributos || {}).forEach(function (nombre) {
      nodo.setAttribute(nombre, atributos[nombre]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var hijo = arguments[i];
      if (hijo !== null && hijo !== undefined) nodo.append(hijo);
    }
    return nodo;
  }

  function mensajeError(id, texto) {
    var caja = el("div", id ? { class: "error-msg", id: id } : { class: "error-msg" });
    caja.innerHTML = ICONO_ERROR; // constante propia, sin datos externos
    caja.append(el("span", null, texto));
    return caja;
  }

  function tituloResultado() {
    return el("h2", { class: "section-title", id: "h-resultado" }, "Resultado");
  }

  function pintar() {
    var nodos = Array.prototype.filter.call(arguments, function (nodo) {
      return nodo !== null;
    });
    seccionResultado.replaceChildren.apply(seccionResultado, nodos);
  }

  // -------------------------------------------------------------------------
  // Formato de entrada (A: dirección/prefijo, B: dirección y máscara)
  // -------------------------------------------------------------------------

  function cambiarForma(nueva) {
    forma = nueva;
    botonesForma.forEach(function (boton) {
      boton.setAttribute("aria-pressed", String(boton.dataset.forma === nueva));
    });
    bloques.a.hidden = nueva !== "a";
    bloques.b.hidden = nueva !== "b";
  }

  function primerCampo() {
    return forma === "a" ? campos.entrada : campos.direccion;
  }

  function cuerpoPeticion() {
    if (forma === "a") return { entrada: campos.entrada.value };
    return { direccion: campos.direccion.value, mascara: campos.mascara.value };
  }

  // Al cambiar de formato, el otro formulario recibe el equivalente del
  // último resultado, para que la tabla visible siga correspondiendo.
  function rellenarDesdeResultado(destino) {
    if (!ultimoResultado) return;
    var e = ultimoResultado.entrada;
    if (destino === "a") {
      campos.entrada.value = e.direccion + "/" + e.prefijo;
    } else {
      campos.direccion.value = e.direccion;
      campos.mascara.value = e.mascara;
    }
  }

  // -------------------------------------------------------------------------
  // Errores en los campos
  // -------------------------------------------------------------------------

  function limpiarErrores() {
    Object.keys(campos).forEach(function (nombre) {
      var input = campos[nombre];
      var previo = document.getElementById("err-" + nombre);
      if (previo) previo.remove();
      input.removeAttribute("aria-invalid");
      input.setAttribute("aria-describedby", "hint-" + nombre);
    });
  }

  function marcarError(nombre, texto, enfocar) {
    var input = campos[nombre];
    // Como en el diseño: el mensaje va entre la pista y el input.
    input.before(mensajeError("err-" + nombre, texto));
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", "hint-" + nombre + " err-" + nombre);
    if (enfocar) input.focus();
  }

  // -------------------------------------------------------------------------
  // Estados del panel de resultado
  // -------------------------------------------------------------------------

  function pintarVacio() {
    pintar(
      tituloResultado(),
      el(
        "div",
        { class: "empty" },
        el("p", null, "Todavía no hay resultado."),
        el(
          "p",
          { class: "small" },
          "Escribe una dirección con prefijo, o una dirección y su máscara, y pulsa " +
            "Calcular. También puedes cargar uno de los casos de prueba."
        )
      )
    );
  }

  function pintarErrorValidacion(campo) {
    var nombre = NOMBRE_CAMPO[campo] || "los datos";
    pintar(
      tituloResultado(),
      el(
        "div",
        { class: "empty" },
        el("p", null, "Todavía no hay resultado. Corrige " + nombre + " y vuelve a calcular."),
        el("p", { class: "small" }, TEXTO_VALIDACION)
      )
    );
  }

  // Fallos que el usuario no provoca escribiendo: red caída, 400, 5xx…
  function pintarErrorServicio(texto) {
    var aviso = mensajeError(null, texto);
    aviso.setAttribute("role", "alert");
    pintar(
      tituloResultado(),
      el(
        "div",
        { class: "empty" },
        aviso,
        el(
          "p",
          { class: "small" },
          "Si el problema continúa, comprueba que la API esté en marcha (GET /api/salud)."
        )
      )
    );
  }

  function valorBits(binario, bitsRed) {
    var contenedor = el("div", { class: "bits-value" });
    var octetos = binario.split(".");
    octetos.forEach(function (octeto, i) {
      var corte = Math.min(8, Math.max(0, bitsRed - i * 8));
      var span = el("span", { class: "octet" });
      if (corte > 0) span.append(el("span", { class: "net" }, octeto.slice(0, corte)));
      if (corte < 8) span.append(el("span", { class: "host" }, octeto.slice(corte)));
      if (i < octetos.length - 1) span.append(".");
      contenedor.append(span);
    });
    return contenedor;
  }

  function filaBits(etiqueta, binario, bitsRed) {
    return el(
      "div",
      { class: "bits-row" },
      el("div", { class: "bits-label" }, etiqueta),
      valorBits(binario, bitsRed)
    );
  }

  function pintarResultado(datos) {
    var botonCopiar = el("button", { type: "button", class: "btn-copy" }, "Copiar resultado");
    botonCopiar.addEventListener("click", function () {
      copiarResultado(botonCopiar);
    });

    var cabecera = el(
      "div",
      { class: "result-head" },
      el("div", null, tituloResultado(), el("p", { class: "interpreted" }, datos.entrada.texto)),
      botonCopiar
    );

    var nota = null;
    if (datos.nota) {
      nota = el(
        "div",
        { class: "note", role: "note" },
        el("strong", null, datos.nota.titulo),
        " " + datos.nota.texto
      );
    }

    var tabla = el("dl", { class: "results" });
    datos.filas.forEach(function (fila) {
      var clase = !fila.aplica ? { class: "na" } : fila.mono ? { class: "mono" } : null;
      tabla.append(
        el("div", { class: "row" }, el("dt", null, fila.etiqueta), el("dd", clase, fila.valor))
      );
    });

    var b = datos.binario;
    pintar(
      cabecera,
      nota,
      tabla,
      el("h3", { class: "bits-title" }, "Representación binaria"),
      el(
        "p",
        { class: "bits-hint" },
        "Los bits en negrita pertenecen a la porción de red; los de peso normal, a la de host."
      ),
      filaBits("Dirección", b.direccion, b.bits_red),
      filaBits("Máscara", b.mascara, b.bits_red),
      b.red ? filaBits("Red", b.red, b.bits_red) : null
    );
  }

  // -------------------------------------------------------------------------
  // Llamada a la API
  // -------------------------------------------------------------------------

  // enfocarError: true cuando el usuario envía el formulario; al cargar un
  // caso de prueba el foco se queda en la lista.
  function calcular(enfocarError) {
    if (peticionEnCurso) peticionEnCurso.abort();
    var control = new AbortController();
    peticionEnCurso = control;

    limpiarErrores();
    seccionResultado.setAttribute("aria-busy", "true");

    fetch(API + "/calcular", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(cuerpoPeticion()),
      signal: control.signal,
    })
      .then(function (respuesta) {
        return respuesta
          .json()
          .catch(function () {
            return null; // p. ej. página HTML de un 502 de Nginx
          })
          .then(function (datos) {
            return { estado: respuesta.status, datos: datos };
          });
      })
      .then(function (r) {
        if (peticionEnCurso !== control) return; // llegó otra petición después
        var datos = r.datos;
        if (r.estado === 200 && datos && datos.ok) {
          ultimoResultado = datos;
          pintarResultado(datos);
          return;
        }
        ultimoResultado = null;
        var error = datos && datos.errores && datos.errores[0];
        if (r.estado === 422 && error && campos[error.campo]) {
          marcarError(error.campo, error.mensaje, enfocarError);
          pintarErrorValidacion(error.campo);
        } else if (error) {
          pintarErrorServicio(error.mensaje);
        } else {
          pintarErrorServicio(
            "Error: el servidor respondió de forma inesperada (HTTP " + r.estado + "). " +
              "Inténtalo de nuevo en unos segundos."
          );
        }
      })
      .catch(function (fallo) {
        if (fallo && fallo.name === "AbortError") return;
        if (peticionEnCurso !== control) return;
        ultimoResultado = null;
        pintarErrorServicio(
          "Error: no se pudo conectar con el servidor. Comprueba la conexión e inténtalo de nuevo."
        );
      })
      .finally(function () {
        if (peticionEnCurso === control) {
          peticionEnCurso = null;
          seccionResultado.removeAttribute("aria-busy");
        }
      });
  }

  // -------------------------------------------------------------------------
  // Casos de prueba (vienen de la API: una sola lista, la de calc/casos.py)
  // -------------------------------------------------------------------------

  function textoCaso(caso) {
    return caso.entrada !== undefined ? caso.entrada : caso.direccion + " + " + caso.mascara;
  }

  function coincideConFormulario(caso) {
    if (caso.entrada !== undefined) {
      return forma === "a" && campos.entrada.value.trim() === caso.entrada;
    }
    return (
      forma === "b" &&
      campos.direccion.value.trim() === caso.direccion &&
      campos.mascara.value.trim() === caso.mascara
    );
  }

  var botonesCaso = []; // [{boton, caso}]

  function marcarCasoActual() {
    botonesCaso.forEach(function (par) {
      if (coincideConFormulario(par.caso)) par.boton.setAttribute("aria-current", "true");
      else par.boton.removeAttribute("aria-current");
    });
  }

  function cargarCaso(caso) {
    if (caso.entrada !== undefined) {
      cambiarForma("a");
      campos.entrada.value = caso.entrada;
    } else {
      cambiarForma("b");
      campos.direccion.value = caso.direccion;
      campos.mascara.value = caso.mascara;
    }
    marcarCasoActual();
    calcular();
  }

  function pintarCasos(casos) {
    listaCasos.replaceChildren();
    botonesCaso = [];
    casos.forEach(function (caso) {
      var boton = el(
        "button",
        { type: "button" },
        el("span", { class: "case-value" }, textoCaso(caso)),
        el("span", { class: "case-tag" }, caso.etiqueta)
      );
      botonesCaso.push({ boton: boton, caso: caso });
      boton.addEventListener("click", function () {
        cargarCaso(caso);
      });
      listaCasos.append(el("li", null, boton));
    });
    marcarCasoActual();
  }

  function cargarCasos() {
    fetch(API + "/casos-de-prueba", { headers: { Accept: "application/json" } })
      .then(function (respuesta) {
        if (!respuesta.ok) throw new Error("HTTP " + respuesta.status);
        return respuesta.json();
      })
      .then(pintarCasos)
      .catch(function () {
        pistaCasos.textContent = "No se pudieron cargar los casos de prueba desde el servidor.";
      });
  }

  // -------------------------------------------------------------------------
  // Copiar resultado
  // -------------------------------------------------------------------------

  function textoParaCopiar(datos) {
    var lineas = ["Entrada: " + datos.entrada.texto];
    if (datos.nota) lineas.push("Nota: " + datos.nota.titulo + " " + datos.nota.texto);
    lineas.push("");
    datos.filas.forEach(function (fila) {
      lineas.push(fila.etiqueta + ": " + fila.valor);
    });
    lineas.push("", "Representación binaria");
    lineas.push("Dirección: " + datos.binario.direccion);
    lineas.push("Máscara: " + datos.binario.mascara);
    if (datos.binario.red) lineas.push("Red: " + datos.binario.red);
    return lineas.join("\n");
  }

  // navigator.clipboard solo existe en contexto seguro (HTTPS o localhost);
  // el servidor de producción sirve HTTP por IP, así que hay plan B.
  function copiarTexto(texto) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(texto).then(
        function () {
          return true;
        },
        function () {
          return copiarConTextarea(texto);
        }
      );
    }
    return Promise.resolve(copiarConTextarea(texto));
  }

  function copiarConTextarea(texto) {
    var area = el("textarea", {
      readonly: "",
      "aria-hidden": "true",
      style: "position:fixed;top:0;left:0;opacity:0",
    });
    area.value = texto;
    document.body.append(area);
    area.select();
    var ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (e) {
      ok = false;
    }
    area.remove();
    return ok;
  }

  var temporizadorCopia = null;

  function copiarResultado(boton) {
    if (!ultimoResultado) return;
    copiarTexto(textoParaCopiar(ultimoResultado)).then(function (ok) {
      boton.textContent = ok ? "Copiado" : "No se pudo copiar";
      boton.focus();
      clearTimeout(temporizadorCopia);
      temporizadorCopia = setTimeout(function () {
        boton.textContent = "Copiar resultado";
      }, 2000);
    });
  }

  // -------------------------------------------------------------------------
  // Eventos
  // -------------------------------------------------------------------------

  formulario.addEventListener("submit", function (evento) {
    evento.preventDefault();
    calcular(true);
  });

  formulario.addEventListener("input", marcarCasoActual);

  botonesForma.forEach(function (boton) {
    boton.addEventListener("click", function () {
      var nueva = boton.dataset.forma;
      if (nueva === forma) return;
      limpiarErrores();
      rellenarDesdeResultado(nueva);
      cambiarForma(nueva);
      marcarCasoActual();
    });
  });

  document.getElementById("btn-limpiar").addEventListener("click", function () {
    if (peticionEnCurso) peticionEnCurso.abort();
    peticionEnCurso = null;
    seccionResultado.removeAttribute("aria-busy");
    Object.keys(campos).forEach(function (nombre) {
      campos[nombre].value = "";
    });
    ultimoResultado = null;
    limpiarErrores();
    marcarCasoActual();
    pintarVacio();
    primerCampo().focus();
  });

  // Al abrir no se calcula nada: el formulario y el resultado empiezan
  // vacíos (el estado vacío ya viene en index.html).
  cargarCasos();
})();
