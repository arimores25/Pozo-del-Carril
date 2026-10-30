/**
 * ============================================================================
 * POZO DEL CARRIL - GESTIÓN GANADERA BOVINA
 * ARCHIVO: Code.gs (API Webhook y Backend de Apps Script — Etapa 2)
 * ============================================================================
 * INSTRUCCIONES:
 * 1. Pega este archivo en Extensiones > Apps Script como "Code.gs".
 * 2. Guarda los cambios.
 * 3. Haz clic en "Implementar" > "Nueva implementación" (o "Administrar implementaciones" > Editar > Nueva versión).
 * 4. Tipo de implementación: "Aplicación web".
 * 5. Ejecutar como: "Yo" (tu cuenta de Google).
 * CÓMO ACTUALIZAR SI YA TENÉS UNA PLANILLA CONECTADA (SIN BORRAR DATOS):
 * 1. En tu Google Sheet actual, abrí "Extensiones > Apps Script".
 * 2. Seleccioná el archivo "Code.gs", borrá su contenido y pegá este código.
 * 3. Tocá el ícono de Guardar (disquete o Ctrl+S).
 * 4. Arriba a la derecha, tocá "Implementar > Administrar implementaciones".
 * 5. Tocá el ícono de lápiz ("Editar") arriba a la derecha de tu implementación activa.
 * 6. En el desplegable "Versión", elegí "Nueva versión" y tocá "Implementar".
 *    (O bien "Implementar > Nueva implementación" y pegá la nueva URL /exec en el sistema).
 * ============================================================================
 */

function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  const accion = params.accion || params.action || 'ping';
  
  if (accion === 'ping') {
    return responderJSON({
      estado: 'OK',
      status: 'ok',
      version_etapa2: true,
      funciones: ['insertar', 'actualizar', 'eliminar', 'sincronizar_lote', 'obtener_todo', 'obtener_tabla'],
      mensaje: 'Servicio Pozo del Carril Activo (Etapa 2 CRUD + Upsert Idempotente)',
      fecha: new Date().toISOString()
    });
  }
  
  if (accion === 'obtener_todo' || accion === 'readAll') {
    return responderJSON(obtenerTodasLasTablas());
  }

  if (accion === 'obtener_tabla') {
    const tabla = params.tabla || params.table;
    if (!tabla) return responderJSON({ error: 'Falta parámetro tabla' }, 400);
    return responderJSON({ exito: true, tabla: tabla, datos: obtenerDatosTabla(tabla) });
  }

  return responderJSON({ error: 'Acción GET no reconocida: ' + accion }, 400);
}

function doPost(e) {
  try {
    let body = {};
    if (e && e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    }
    
    const accion = body.accion || body.action;
    
    // Autenticación de usuario contra la tabla USUARIOS
    if (accion === 'autenticar') {
      const resAuth = autenticarUsuarioEnSheets(body.email, body.password);
      return responderJSON(resAuth);
    }
    
    // Insertar registro con LockService e idempotencia por clave primaria (upsert)
    if (accion === 'insertar') {
      const resIns = insertarFilaEnTabla(body.tabla, body.datos, body.usuario, body.idCampo);
      return responderJSON(resIns);
    }

    // Actualizar fila existente por ID (con fallback a inserción idempotente si no existía)
    if (accion === 'actualizar') {
      const resAct = actualizarFilaEnTabla(body.tabla, body.idCampo, body.idValor, body.datos, body.usuario);
      return responderJSON(resAct);
    }

    // Eliminar fila por ID
    if (accion === 'eliminar') {
      const resDel = eliminarFilaEnTabla(body.tabla, body.idCampo, body.idValor, body.usuario);
      return responderJSON(resDel);
    }

    // Sincronizar lote completo de tablas sin sobrescribir registros más recientes
    if (accion === 'sincronizar_lote') {
      const resBatch = sincronizarTablasBatch(body.tablas, body.usuario);
      return responderJSON(resBatch);
    }

    // Envío de notificaciones por correo electrónico mediante MailApp: DESACTIVADO
    if (accion === 'enviar_email') {
      return responderJSON({
        exito: false,
        desactivado: true,
        proveedor: 'DESACTIVADO',
        error: 'El envío automático de notificaciones y correos de alertas se encuentra desactivado en Pozo del Carril.'
      });
    }

    return responderJSON({ exito: false, error: 'Acción POST no reconocida: ' + accion }, 400);
  } catch (err) {
    Logger.log('Error doPost: ' + err.toString());
    return responderJSON({ exito: false, error: err.toString() }, 500);
  }
}

function responderJSON(objeto, status) {
  const output = ContentService.createTextOutput(JSON.stringify(objeto));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

function serializarValorCelda(val) {
  if (val === undefined || val === null) return '';
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'object') {
    try {
      return JSON.stringify(val);
    } catch (e) {
      return String(val);
    }
  }
  return val;
}

function obtenerOCrearHojaConEncabezados(ss, nombreTabla, datosMuestra) {
  let sheet = ss.getSheetByName(nombreTabla);
  if (!sheet) {
    sheet = ss.insertSheet(nombreTabla);
    const claves = datosMuestra && typeof datosMuestra === 'object' ? Object.keys(datosMuestra) : ['id'];
    if (claves.length > 0) {
      sheet.getRange(1, 1, 1, claves.length).setValues([claves]);
      sheet.setFrozenRows(1);
    }
  } else if (sheet.getLastRow() === 0 && datosMuestra && typeof datosMuestra === 'object') {
    const claves = Object.keys(datosMuestra);
    if (claves.length > 0) {
      sheet.getRange(1, 1, 1, claves.length).setValues([claves]);
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

function asegurarColumnasEnHoja(sheet, headersActuales, datosObjeto) {
  if (!datosObjeto || typeof datosObjeto !== 'object') return headersActuales;
  const headers = headersActuales.slice();
  const nuevosHeaders = [];
  const clavesDatos = Object.keys(datosObjeto);

  for (let i = 0; i < clavesDatos.length; i++) {
    const k = clavesDatos[i];
    if (!k) continue;
    if (headers.indexOf(k) === -1) {
      headers.push(k);
      nuevosHeaders.push(k);
    }
  }

  if (nuevosHeaders.length > 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return headers;
}

function autenticarUsuarioEnSheets(email, password) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('USUARIOS');
  if (!sh) return { exito: false, error: 'Tabla USUARIOS no encontrada en Sheets' };

  const values = sh.getDataRange().getValues();
  if (values.length <= 1) return { exito: false, error: 'Tabla USUARIOS sin registros' };

  const headers = values[0];
  const idxEmail = headers.indexOf('email');
  const idxPass = headers.indexOf('password_hash');
  const idxEstado = headers.indexOf('estado');
  const idxNombre = headers.indexOf('nombre');
  const idxRol = headers.indexOf('rol');
  const idxUltimoIngreso = headers.indexOf('ultimo_ingreso');

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (row[idxEmail] && row[idxEmail].toString().toLowerCase().trim() === email.toLowerCase().trim()) {
      if (row[idxEstado] !== 'Activo') {
        return {
          exito: false,
          error: 'Acceso denegado: El usuario se encuentra en estado ' + row[idxEstado] + ' (Licencia inactiva).'
        };
      }
      if (row[idxPass] && row[idxPass].toString() === password.toString()) {
        const nowStr = Utilities.formatDate(new Date(), 'GMT-3', 'yyyy-MM-dd HH:mm:ss');
        if (idxUltimoIngreso >= 0) {
          sh.getRange(i + 1, idxUltimoIngreso + 1).setValue(nowStr);
        }
        registrarEnAuditoria('LOGIN', 'USUARIOS', row[0], 'Ingreso exitoso', row[idxNombre]);
        return {
          exito: true,
          usuario: {
            id_usuario: row[0],
            nombre: row[idxNombre],
            email: row[idxEmail],
            rol: row[idxRol],
            estado: row[idxEstado],
            ultimo_ingreso: nowStr
          }
        };
      } else {
        return { exito: false, error: 'Contraseña incorrecta' };
      }
    }
  }
  return { exito: false, error: 'Usuario inexistente en Google Sheets' };
}

function obtenerTodasLasTablas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  const resultado = {};

  for (let s of sheets) {
    const nombre = s.getName();
    resultado[nombre] = obtenerDatosTabla(nombre);
  }
  return {
    status: 'ok',
    exito: true,
    tablas: resultado,
    data: resultado,
    timestamp: new Date().toISOString()
  };
}

function obtenerDatosTabla(nombreTabla) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(nombreTabla);
  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  const headers = data[0];
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const fila = data[i];
    const esVacia = fila.every(function(c) { return c === '' || c === null || c === undefined; });
    if (esVacia) continue;
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = fila[j];
    }
    rows.push(obj);
  }
  return rows;
}

/**
 * Inserta una fila de forma IDEMPOTENTE: si el ID primario ya existe en la hoja,
 * actualiza la fila existente en lugar de duplicarla.
 */
function insertarFilaEnTabla(nombreTabla, datos, usuario, idCampoOpcional) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (!nombreTabla || !datos || typeof datos !== 'object') {
      return { exito: false, error: 'Parámetros inválidos para insertarFilaEnTabla' };
    }
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = obtenerOCrearHojaConEncabezados(ss, nombreTabla, datos);

    const lastCol = Math.max(1, sheet.getLastColumn());
    let headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    headers = asegurarColumnasEnHoja(sheet, headers, datos);

    const campoClave = idCampoOpcional && headers.indexOf(idCampoOpcional) >= 0 ? idCampoOpcional : headers[0];
    const idxClave = Math.max(0, headers.indexOf(campoClave));
    const valorClave = datos[campoClave] !== undefined ? String(datos[campoClave]).trim() : '';

    // Verificar si ya existe una fila con el mismo ID para evitar duplicaciones
    if (valorClave && sheet.getLastRow() > 1) {
      const allValues = sheet.getDataRange().getValues();
      for (let i = 1; i < allValues.length; i++) {
        if (String(allValues[i][idxClave]).trim() === valorClave) {
          const filaExistente = allValues[i];
          const filaActualizada = [];
          for (let j = 0; j < headers.length; j++) {
            const col = headers[j];
            if (datos[col] !== undefined) {
              filaActualizada.push(serializarValorCelda(datos[col]));
            } else {
              filaActualizada.push(filaExistente[j] !== undefined ? filaExistente[j] : '');
            }
          }
          sheet.getRange(i + 1, 1, 1, headers.length).setValues([filaActualizada]);
          registrarEnAuditoria('MODIFICACION_IDEMPOTENTE', nombreTabla, valorClave, 'Registro actualizado sin duplicar', usuario || 'Sistema');
          return { exito: true, operacion: 'actualizado_idempotente', id: valorClave, fila: i + 1 };
        }
      }
    }

    const nuevaFila = [];
    for (let j = 0; j < headers.length; j++) {
      const col = headers[j];
      nuevaFila.push(datos[col] !== undefined ? serializarValorCelda(datos[col]) : '');
    }
    sheet.appendRow(nuevaFila);
    registrarEnAuditoria('ALTA', nombreTabla, valorClave || 'S/ID', 'Nuevo registro', usuario || 'Sistema');
    return { exito: true, operacion: 'insertado', id: valorClave };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Actualiza una fila existente por idCampo = idValor.
 * Si el registro aún no existe en la hoja (ej. fue creado offline), lo inserta mediante upsert
 * para no perder jamás una operación editada.
 */
function actualizarFilaEnTabla(nombreTabla, idCampo, idValor, datos, usuario) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (!nombreTabla || !datos || typeof datos !== 'object') {
      return { exito: false, error: 'Parámetros inválidos para actualizarFilaEnTabla' };
    }
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = obtenerOCrearHojaConEncabezados(ss, nombreTabla, datos);

    const lastCol = Math.max(1, sheet.getLastColumn());
    let headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    headers = asegurarColumnasEnHoja(sheet, headers, datos);

    const campoBusqueda = idCampo && headers.indexOf(idCampo) >= 0 ? idCampo : headers[0];
    const idxCol = Math.max(0, headers.indexOf(campoBusqueda));
    const valorBuscado = String(idValor !== undefined && idValor !== null ? idValor : (datos[campoBusqueda] || '')).trim();

    if (!valorBuscado) {
      return { exito: false, error: 'Falta valor identificador (idValor) para actualizar en ' + nombreTabla };
    }

    if (sheet.getLastRow() > 1) {
      const values = sheet.getDataRange().getValues();
      for (let i = 1; i < values.length; i++) {
        if (String(values[i][idxCol]).trim() === valorBuscado) {
          const filaPrevia = values[i];
          const filaNueva = [];
          for (let j = 0; j < headers.length; j++) {
            const col = headers[j];
            if (datos[col] !== undefined) {
              filaNueva.push(serializarValorCelda(datos[col]));
            } else {
              filaNueva.push(filaPrevia[j] !== undefined ? filaPrevia[j] : '');
            }
          }
          sheet.getRange(i + 1, 1, 1, headers.length).setValues([filaNueva]);
          registrarEnAuditoria('MODIFICACION', nombreTabla, valorBuscado, 'Registro actualizado', usuario || 'Sistema');
          return { exito: true, operacion: 'actualizado', id: valorBuscado, fila: i + 1 };
        }
      }
    }

    // Upsert: si no existía la fila en la planilla, insertarla para asegurar persistencia
    const filaInsertar = [];
    for (let j = 0; j < headers.length; j++) {
      const col = headers[j];
      filaInsertar.push(datos[col] !== undefined ? serializarValorCelda(datos[col]) : '');
    }
    sheet.appendRow(filaInsertar);
    registrarEnAuditoria('ALTA_POR_UPSERT', nombreTabla, valorBuscado, 'Insertado al actualizar registro ausente en hoja', usuario || 'Sistema');
    return { exito: true, operacion: 'insertado_por_upsert', id: valorBuscado };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Sincroniza un lote de tablas mediante upsert por clave primaria,
 * respetando ultima_modificacion_ts para no sobrescribir datos remotos más recientes con copias locales viejas.
 */
function sincronizarTablasBatch(tablas, usuario) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    if (!tablas || typeof tablas !== 'object') {
      return { exito: false, error: 'Objeto tablas inválido en sincronizarTablasBatch' };
    }
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const resumen = {};
    const nombresTablas = Object.keys(tablas);

    for (let t = 0; t < nombresTablas.length; t++) {
      const nombreTabla = nombresTablas[t];
      const listaRegistros = tablas[nombreTabla];
      if (!Array.isArray(listaRegistros) || listaRegistros.length === 0) continue;

      const sheet = obtenerOCrearHojaConEncabezados(ss, nombreTabla, listaRegistros[0]);
      const lastCol = Math.max(1, sheet.getLastColumn());
      let headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
      headers = asegurarColumnasEnHoja(sheet, headers, listaRegistros[0]);

      const idxId = 0;
      const idxTs = headers.indexOf('ultima_modificacion_ts');
      const existingData = sheet.getLastRow() > 1 ? sheet.getDataRange().getValues() : [headers];
      const mapIndicePorId = {};

      for (let r = 1; r < existingData.length; r++) {
        const idExistente = String(existingData[r][idxId] || '').trim();
        if (idExistente) {
          mapIndicePorId[idExistente] = r;
        }
      }

      let insertados = 0;
      let actualizados = 0;
      let omitidosPorMasReciente = 0;

      for (let k = 0; k < listaRegistros.length; k++) {
        const item = listaRegistros[k];
        if (!item || typeof item !== 'object') continue;
        const idVal = String(item[headers[0]] || '').trim();
        if (!idVal) continue;

        const rowIndex = mapIndicePorId[idVal];
        if (rowIndex !== undefined) {
          const filaRemota = existingData[rowIndex];
          if (idxTs >= 0 && filaRemota[idxTs] && item.ultima_modificacion_ts) {
            const tsRemoto = String(filaRemota[idxTs]).trim();
            const tsLocal = String(item.ultima_modificacion_ts).trim();
            if (tsRemoto > tsLocal) {
              omitidosPorMasReciente++;
              continue;
            }
          }
          const filaAct = [];
          for (let c = 0; c < headers.length; c++) {
            const colName = headers[c];
            filaAct.push(item[colName] !== undefined ? serializarValorCelda(item[colName]) : (filaRemota[c] !== undefined ? filaRemota[c] : ''));
          }
          sheet.getRange(rowIndex + 1, 1, 1, headers.length).setValues([filaAct]);
          actualizados++;
        } else {
          const filaNueva = [];
          for (let c = 0; c < headers.length; c++) {
            const colName = headers[c];
            filaNueva.push(item[colName] !== undefined ? serializarValorCelda(item[colName]) : '');
          }
          sheet.appendRow(filaNueva);
          insertados++;
        }
      }

      resumen[nombreTabla] = { insertados: insertados, actualizados: actualizados, omitidosPorMasReciente: omitidosPorMasReciente };
    }

    registrarEnAuditoria('SINCRONIZACION_LOTE', 'TODAS', 'BATCH', JSON.stringify(resumen), usuario || 'Sistema');
    return { exito: true, resumen: resumen };
  } finally {
    lock.releaseLock();
  }
}

function eliminarFilaEnTabla(nombreTabla, idCampo, idValor, usuario) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(nombreTabla);
    if (!sheet) throw new Error('No existe la tabla ' + nombreTabla);

    const values = sheet.getDataRange().getValues();
    if (values.length <= 1) return { exito: false, error: 'Tabla vacía' };

    const headers = values[0];
    let idxCol = headers.indexOf(idCampo);
    if (idxCol < 0) idxCol = 0;

    for (let i = values.length - 1; i >= 1; i--) {
      if (String(values[i][idxCol]).trim() === String(idValor).trim()) {
        sheet.deleteRow(i + 1);
        registrarEnAuditoria('BAJA', nombreTabla, idValor, 'Registro eliminado', usuario || 'Sistema');
        return { exito: true };
      }
    }
    return { exito: false, error: 'Registro no encontrado' };
  } finally {
    lock.releaseLock();
  }
}

function registrarEnAuditoria(accion, tabla, idReg, detalle, usuario) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sh = ss.getSheetByName('AUDITORIA');
    if (!sh) return;
    const now = new Date();
    const id = 'AUD-' + Utilities.getUuid().substring(0, 8);
    sh.appendRow([
      id,
      Utilities.formatDate(now, 'GMT-3', 'yyyy-MM-dd'),
      Utilities.formatDate(now, 'GMT-3', 'HH:mm:ss'),
      usuario || 'Sistema',
      accion,
      'Backend Apps Script',
      tabla,
      idReg || '-',
      '-',
      detalle || '',
      'EXITO',
      'Registrado por Apps Script'
    ]);
  } catch (e) {
    Logger.log('Error auditoría: ' + e.message);
  }
}


