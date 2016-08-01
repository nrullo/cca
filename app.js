/* jshint esversion: 6 */

process.on('uncaughtException', function(err) {
  console.error((new Date()).toUTCString() + ' uncaughtException: ' + err.message);
  console.error(err.stack);
  process.exit(1);
});

var express = require('express'),
  config = require('./config/config'),
  moment = require('moment'),
  Download = require('download'),
  CronJob = require('cron').CronJob,
  glob = require('glob'),
  co = require('co'),
  LineReader = require('line-by-line-promise'),
  MongoClient = require('mongodb').MongoClient,
  fs = require('fs'),
  del = require('delete'),
  nodemailer = require('nodemailer'),
  PropertiesReader = require('properties-reader'),
  findRemoveSync = require('find-remove'),
  winston = require('winston'),
  fileCompare = require('file-compare'),
  countLinesInFile = require('count-lines-in-file');

var db = require('./db');

var properties = PropertiesReader('./config/production_vodemia.properties');

var cantContribuyentes = 0;

var logger = new(winston.Logger)({
  transports: [
    new(winston.transports.File)({
      name: 'log-file',
      filename: 'logs/log-file.log'
    })
  ]
});

var app = express();

require('./config/express')(app, config);

var enviarMail = function(subject, body) {
  logger.info('enviarMail executed...');

  var options = {
    host: properties.get('smtp.host'),
    port: properties.get('smtp.port'),
    secure: false,
    auth: {
      user: properties.get('smtp.user'),
      pass: properties.get('smtp.passwd')
    }
  };

  var transporter = nodemailer.createTransport(options);

  var mailOptions = {
    from: properties.get('smtp.mail_from'),
    to: properties.get('smtp.mail_to'),
    subject: subject,
    text: body
  };

  logger.info('Executing transporter...');
  transporter.sendMail(mailOptions, function(error, info) {
    if (err) {
      logger.error(err);
      throw err;
    }
    logger.info('Email sent: ' + info.response);
  });
};

app.listen(config.port, function() {
  logger.info('Express server listening on port ' + config.port);

  try {
    logger.info('Connecting to mongodb server...');

    db.connect(config.db, function(err) {

      if (err) {
        throw 'Failed mongodb connection';
      }
      logger.info('Connected correctly to mongodb server. db: ' + config.db);

      // Crea las colecciones si no existen
      db.get().createCollection('contribuyentes');
      db.get().createCollection('contribuyentes_bak');

      removeOldFilesJob.start();
      downloadAndParseDataJob.start();
      saveDataJob.start();
    });
  } catch (err) {
    logger.error(err);
    enviarMail('[CCA] Error', err.message);
  }
});

// Borrar los archivos de la AFIP ya bajados que sean
// más viejos a 3 días
var removeOldFilesJob = new CronJob({
  cronTime: properties.get('cron.removeOldFilesJob'),
  onTick: function() {
    logger.info('Executing removeOldFilesJob job... ');

    try {
      var result = findRemoveSync('downloads/', {
        age: {
          seconds: 259200 // Remuevo los archivos +3days
        }
      });
    } catch (err) {
      logger.error(err);
      enviarMail('[CCA] Error al remover viejos archivos...', err.message);
    }

  },
  onComplete: function() {
    logger.info('Job removeFilesJob finished...');
  }
});

// Baja el archivo de la AFIP, lo parsea y lo guarda en
// una colección de respaldo
var downloadAndParseDataJob = new CronJob({
  cronTime: properties.get('cron.downloadAndParseDataJob'),
  onTick: function() {
    logger.info('Executing downloadAndParseDataJob job... ');

    try {
      downloadAndGetData();
    } catch (err) {
      logger.error(err);
      enviarMail('[CCA] Error al bajar archivo y parsear contribuyentes...', err.message);
    }
  },
  onComplete: function() {
    logger.info('Job downloadAndParseDataJob finished...');
  }
});

// Verifica que la colección de respaldo contenga la misma
// cantidad de documentos que lineas leídas y luego
// lo renombre a la colección utilizada posteriormente
var saveDataJob = new CronJob({
  cronTime: properties.get('cron.saveDataJob'),
  onTick: function() {
    logger.info('Executing saveDataJob job... ');

    try {
      saveData();
    } catch (err) {
      logger.error(err);
      enviarMail('[CCA] Error al guardar data...', err.message);
    }
  },
  onComplete: function() {
    logger.info('Job saveDataJob finished...');
  }
});

// Baja el archivo de la AFIP, lo parsea y lo guarda en
// una colección de respaldo
var downloadAndGetData = function() {
  logger.info('Downloading and decompressing AFIP zip file: ' + properties.get('afip.uri'));
  var download = new Download({
    mode: '755',
    extract: true
  });
  var hoy = moment();
  var anterior = moment(hoy).subtract(1, 'days');
  download
    .get(properties.get('afip.uri'))
    .dest('downloads')
    .rename('afip_contr_' + hoy.format('YYYYMMDD'))
    .run(function(err, files) {
      if (err) {
        logger.error('Error al bajar zip padrones de la AFIP...');
        throw 'Error al bajar zip padrones de la AFIP...';
      }
      logger.info('Zip file downloaded and decompressed: ' + files[0].path);

      countLinesInFile(files[0].path, (error, result) => {
        logger.info('Número de líneas: ' + result);
        cantContribuyentes = result;

        var filepathAnterior = files[0].path.replace(files[0].stem, '') + 'afip_contr_' + anterior.format('YYYYMMDD');
        logger.info('filepathAnterior: ' + filepathAnterior);
        if (fileExists(filepathAnterior)) {
          logger.info('Already exists a previous file, comparing...');

          fileCompare.compare(filepathAnterior, files[0].path, function(copied, err) {
            if (err) {
              throw 'Error al comparar los archivos...';
            } else {
              if (copied) {
                logger.info('Files are equal, aborting...');
                return;
              } else {
                logger.info('Files are diff, saving data...');
                getData(files[0].path);
              }
            }
          });
        } else {
          getData(files[0].path);
        }
      });
    });
};

// Parsea las lineas del archivo bajado y los guarda
var getData = function(filepath) {
  var contribuyentes_bak = db.get().collection('contribuyentes_bak');

  contribuyentes_bak.remove({}, function(err, numberRemoved) {
    logger.info('contribuyentes_bak truncated, docs removed: ' + numberRemoved);

    logger.info('Reading file line by line: ' + filepath);
    var file = new LineReader(filepath);
    co(function*() {
      var line;
      // note that eof is defined when `readLine()` yields `null`
      while ((line = yield file.readLine()) !== null) {
        var o = parseLineToObject(line);
        if (o !== null) {
          saveContribuyente(o);
        }
      }
    }).catch(onerror);
  });

  function onerror(err) {
    // log any uncaught errors
    // co will not throw any errors you do not handle!!!
    // HANDLE ALL YOUR ERRORS!!!
    logger.error(err.stack);
    throw 'Error al leer el archivo linea por linea';
  }

  function parseLineToObject(line) {
    var rval = null;
    if (line !== null && line !== '' && line.length > 0) {
      if (properties.get('afip.type') == 'short') {
        rval = {
          cuit: line.slice(0, 11).trim(),
          impIva: line.slice(13, 15).trim(),
          monotributo: line.slice(15, 17).trim()
        };
      } else {
        rval = {
          cuit: line.slice(0, 11).trim(),
          impIva: line.slice(43, 45).trim(),
          monotributo: line.slice(45, 47).trim()
        };
      }
    }
    return rval;
  }

  function saveContribuyente(c) {
    contribuyentes_bak.insert(c, function(err, result) {
      if (err) {
        enviarMail('[CCA] Falló al insertar un documento...', 'CUIT del contribuyente: ' + c.cuit);
        logger.error('Failed to insert mongodb document');
        throw err;
      }
      // logger.info('Contribuyente saved...');
    });
  }
};


// Verifica que la colección de respaldo contenga la misma
// cantidad de documentos que lineas leídas y luego
// lo renombre a la colección utilizada posteriormente
var saveData = function(filepath) {

  try {
    var contribuyentes_bak = db.get().collection('contribuyentes_bak');
    var contribuyentes = db.get().collection('contribuyentes');

    contribuyentes_bak.find({}).count(function(err, count) {
      logger.info('contribuyentes_bak.find({}).count(): ' + count);
      // Si la cantidad que se obtuve en contribuyentes_bak es igual
      // a la cantidad de lineas del archivo, entonces
      // la renombro a contribuyentes y se usa esa
      if (count === cantContribuyentes || (cantContribuyentes === 0 && count > 0)) {
        // enviarMail('[CCA] Cantidad de contribuyentes...', 'La cantidad de contribuyentes actual es ' + count + '.');
        logger.info('Dropping contribuyentes collection...');
        contribuyentes.drop(function(err, reply) {
          if (err) {
            throw 'Error al eliminar contribuyentes';
          }
          logger.info('contribuyentes collection dropped...');

          logger.info('Rename contribuyentes_bak collection to contribuyentes...');
          contribuyentes_bak.rename('contribuyentes', function(error, collection) {
            if (err) {
              throw 'Error al renombrar contribuyentes_bak a contribuyentes...';
            }
            logger.info('contribuyentes_bak collection renamed to contribuyentes...');

            enviarMail('[CCA] Se actualizo la BD...', '[CCA] Se actualizo la BD...');

          });

        });
      } else {
        enviarMail('[CCA] No se actualizo la BD...', '[CCA] No se actualizo la BD...');
      }
    });

  } catch (err) {
    logger.error(err);
    enviarMail('[CCA] Error al verificar cantidad de contribuyentes...', err.message);
  }
};

function fileExists(filePath) {
  logger.info('fileExists executed...');
  try {
    return fs.statSync(filePath).isFile();
  } catch (err) {
    return false;
  }
}
