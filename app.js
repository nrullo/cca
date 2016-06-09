/* jshint esversion: 6 */

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
  fsCompareSync = require('fs-compare').sync,
  del = require('delete'),
  nodemailer = require('nodemailer'),
  PropertiesReader = require('properties-reader'),
  touch = require('touch'),
  findRemoveSync = require('find-remove'),
  winston = require('winston');

var db = require('./db');

var properties = PropertiesReader('./config/production.properties');

var logger = new(winston.Logger)({
  transports: [
    new(winston.transports.File)({
      name: 'info-file',
      filename: 'logs/filelog-info.log',
      level: 'info'
    }),
    new(winston.transports.File)({
      name: 'error-file',
      filename: 'logs/filelog-error.log',
      level: 'error'
    })
  ]
});

var app = express();

require('./config/express')(app, config);

app.listen(config.port, function() {
  logger.info('Express server listening on port ' + config.port);

  logger.info('Connecting to mongodb server...');
  db.connect(config.db, function(err) {
    if (err) {
      enviarMail('[CCA] Error conexión mongodb', 'Hubo un error al conectarse a la base de datos');
      logger.error('Failed mongodb connection');
      throw err;
    }
    logger.info('Connected correctly to mongodb server. db: ' + config.db);

    db.get().createCollection('contribuyentes');
    db.get().createCollection('contribuyentes_bak');
    db.get().createCollection('contribuyentes_bak2');

    removeOldFilesJob.start();
    mainJob.start();
  });
});

var removeOldFilesJob = new CronJob({
  cronTime: properties.get('cron.removeOldFilesJob'),
  onTick: function() {
    logger.info('Executing removeOldFilesJob job... ' + moment().format('YYYYMMDDhhmmss'));

    var result = findRemoveSync('downloads/', {
      age: {
        seconds: 259200
      }
    });

  },
  onComplete: function() {
    logger.info('Job removeFilesJob finished...' + moment().format('YYYYMMDDhhmmss'));
  }
});

var mainJob = new CronJob({
  cronTime: properties.get('cron.mainJob'),
  onTick: function() {
    logger.info('Executing mainJob job... ' + moment().format('YYYYMMDDhhmmss'));

    downloadAndSaveData();
  },
  onComplete: function() {
    logger.info('Job mainJob finished...' + moment().format('YYYYMMDDhhmmss'));
  }
});

var downloadAndSaveData = function() {
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
    .rename('afip_contr_' + hoy.format('YYYYMMDDhhmm'))
    .run(function(err, files) {
      // if (err || files.length !== 1) {
      if (err) {
        enviarMail('[CCA] Failed to download zip file...', 'Failed to download zip file...');
        logger.error('Failed to download zip file...');
        throw err;
      }
      logger.info('Zip file downloaded and decompressed: ' + files[0].path);

      logger.info('Updating timestamp (touching)... ');
      touch(files[0].path, {
        'nocreate': true
      }, function(err) {
        if (err) {
          enviarMail('[CCA] Failed to touch file...', 'Failed to file...');
          logger.error('Error on touch');
        } else {
          logger.info('Touch cool');
        }
      });

      var filepathAnterior = files[0].path.replace(files[0].stem, '') + 'afip_contr_' + anterior.format('YYYYMMDDhhmm');
      if (fileExists(filepathAnterior)) {
        logger.info('Already exists a previous file, comparing...');

        var modifiedTime = function(fileName, cb) {
          return fs.statSync(fileName).mtime;
        };
        var diff = fsCompareSync(modifiedTime, filepathAnterior, files[0].path);
        if (diff === 0) {
          logger.info('Same files... ending...');
          return;
        }
      }

      saveData(files[0].path);
    });
};

var saveData = function(filepath) {

  var contribuyentes_bak2 = db.get().collection('contribuyentes_bak2');
  var contribuyentes_bak = db.get().collection('contribuyentes_bak');
  var contribuyentes = db.get().collection('contribuyentes');

  logger.info('Dropping contribuyentes_bak2 collection...');
  contribuyentes_bak2.drop(function(err, reply) {
    if (err) {
      enviarMail('[CCA] Error al eliminar contribuyentes_bak2', 'Hubo un error al dropear la colección contribuyentes_bak2');
      logger.error('Failed to drop contribuyentes_bak2 collection');
      throw err;
    }
    logger.info('contribuyentes_bak2 collection dropped...');

    logger.info('Rename contribuyentes_bak collection to contribuyentes_bak2...');
    contribuyentes_bak.rename('contribuyentes_bak2', function(error, collection) {
      if (err) {
        enviarMail('[CCA] Error al renombrar contribuyentes_bak', 'Hubo un error al renombrar la colección contribuyentes_bak');
        logger.error('Failed to rename contribuyentes_bak collection to contribuyentes_bak2...');
        throw err;
      }
      logger.info('contribuyentes_bak collection renamed to contribuyentes_bak2...');

      logger.info('Rename contribuyentes collection to contribuyentes_bak...');
      contribuyentes.rename('contribuyentes_bak', function(error, collection) {
        if (err) {
          enviarMail('[CCA] Error al eliminar contribuyentes', 'Hubo un error al renombrar la colección contribuyentes');
          logger.error('Failed to rename contribuyentes collection to contribuyentes_bak...');
          throw err;
        }
        logger.info('contribuyentes collection renamed to contribuyentes_bak...');

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
        });

        function parseLineToObject(line) {
          var rval = null;
          if (line !== null && line !== '' && line.length > 0) {
            rval = {
              cuit: line.slice(0, 11).trim(),
              impIva: line.slice(13, 15).trim(),
              monotributo: line.slice(15, 17).trim()
            };
          }
          return rval;
        }

        function saveContribuyente(c) {
          contribuyentes.insert(c, function(err, result) {
            if (err) {
              enviarMail('[CCA] Falló al insertar un documento...', 'CUIT del contribuyente: ' + c.cuit);
              logger.error('Failed to insert mongodb document');
              throw err;
            }
            // logger.info('Contribuyente saved...');
          });
        }
      });
    });
  });
};

function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch (err) {
    // enviarMail('[CCA] Error al leer archivo previo.', 'No existe el archivo previo. Archivo: ' + filePath);
    logger.error('Failed to read previous file');
    return false;
  }
}

function enviarMail(subject, body) {
  logger.info('enviarMail executed...');
  var options = {
    host: properties.get('smtp.host'),
    port: properties.get('smtp.port'),
    secure: true,
    auth: {
      user: properties.get('smtp.user'),
      pass: properties.get('smtp.passwd')
    }
  };
  var transporter = nodemailer.createTransport(options);

  // setup e-mail data with unicode symbols
  var mailOptions = {
    from: properties.get('smtp.mail_from'), // sender address
    to: properties.get('smtp.mail_to'), // list of receivers
    subject: subject, // Subject line
    text: body
  };

  // send mail with defined transport object
  logger.info('Executing transporter...');
  transporter.sendMail(mailOptions, function(error, info) {
    if (error) {
      return logger.error(error);
    }
    logger.info('Message sent: ' + info.response);
  });
}

process.on('uncaughtException', function(err) {
  logger.error((new Date()).toUTCString() + ' uncaughtException:', err.message);
  logger.error(err.stack);
  try {
    enviarMail('[CCA] Error en CCA', 'Hubo un error en la app. ');
  } catch (errr) {
    logger.error('Error al enviar el mail......');
  }
  process.exit(1);
});
