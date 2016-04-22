/* jshint esversion: 6 */

process.on('uncaughtException', (err) => {
  console.log(`Caught exception: ${err}`);
  enviarMail('[CCA] Error en CCA', 'Hubo un error en la app. ');
});

var express = require('express'),
  config = require('./config/config'),
  moment = require('moment'),
  Download = require('download'),
  CronJob = require('cron').CronJob,
  mongoose = require('mongoose'),
  glob = require('glob'),
  co = require('co'),
  LineReader = require('line-by-line-promise'),
  MongoClient = require('mongodb').MongoClient,
  fs = require('fs'),
  fsCompareSync = require('fs-compare').sync,
  del = require('delete'),
  nodemailer = require('nodemailer'),
  PropertiesReader = require('properties-reader');

var db;
var properties = PropertiesReader('./config/production.properties');

mongoose.connect(config.db);
var db = mongoose.connection;
db.on('error', function() {
  enviarMail('[CCA] Error conexión mongodb', 'Hubo un error al conectarse a la base de datos');
  throw new Error('unable to connect to database at ' + config.db);
});

var models = glob.sync(config.root + '/app/models/*.js');
models.forEach(function(model) {
  require(model);
});
var app = express();

require('./config/express')(app, config);

app.listen(config.port, function() {
  console.log('Express server listening on port ' + config.port);

  console.log('Connecting to mongodb server...');
  MongoClient.connect(config.db, function(err, database) {
    if (err) {
      enviarMail('[CCA] Error conexión mongodb', 'Hubo un error al conectarse a la base de datos');
      console.error('Failed mongodb connection');
      throw err;
    }
    console.log('Connected correctly to mongodb server');
    db = database;

    db.createCollection('contribuyentes');
    db.createCollection('contribuyentes_bak');
    db.createCollection('contribuyentes_bak2');

    // removeFilesJob.start();
    mainJob.start();
  });
});

/*
var removeFilesJob = new CronJob({
  cronTime: properties.get('cron.removeFilesJob'),
  onTick: function() {
    console.log('Executing removeFilesJob job... ' + moment().format('YYYYMMDDhhmmss'));

    del.sync(['/home/usuario/prj/consultasCuitAFIP/cca/downloads/*']);
  },
  onComplete: function() {
    console.log('Job removeFilesJob finished...' + moment().format('YYYYMMDDhhmmss'));
  }
});
*/

var mainJob = new CronJob({
  cronTime: properties.get('cron.mainJob'),
  onTick: function() {
    console.log('Executing mainJob job... ' + moment().format('YYYYMMDDhhmmss'));

    downloadAndSaveData();
  },
  onComplete: function() {
    console.log('Job mainJob finished...' + moment().format('YYYYMMDDhhmmss'));
  }
});

var downloadAndSaveData = function() {
  console.log('Downloading and decompressing AFIP zip file: ' + properties.get('afip.uri'));
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
        console.error('Failed to download zip file...');
        throw err;
      }
      console.log('Zip file downloaded and decompressed: ' + files[0].path);

      var filepathAnterior = files[0].path.replace(files[0].stem, '') + 'afip_contr_' + anterior.format('YYYYMMDDhhmm');
      if (fileExists(filepathAnterior)) {
        console.log('Already exists a previous file, comparing...');

        var modifiedTime = function(fileName, cb) {
          return fs.statSync(fileName).mtime;
        };
        var diff = fsCompareSync(modifiedTime, filepathAnterior, files[0].path);
        if (diff === 0) {
          console.log('Same files... ending...');
          return;
        }
      }

      saveData(files[0].path);
    });
};

var saveData = function(filepath) {

  var contribuyentes_bak2 = db.collection('contribuyentes_bak2');
  var contribuyentes_bak = db.collection('contribuyentes_bak');
  var contribuyentes = db.collection('contribuyentes');

  console.log('Dropping contribuyentes_bak2 collection...');
  contribuyentes_bak2.drop(function(err, reply) {
    if (err) {
      enviarMail('[CCA] Error al eliminar contribuyentes_bak2', 'Hubo un error al dropear la colección contribuyentes_bak2');
      console.error('Failed to drop contribuyentes_bak2 collection');
      throw err;
    }
    console.log('contribuyentes_bak2 collection dropped...');

    console.log('Rename contribuyentes_bak collection to contribuyentes_bak2...');
    contribuyentes_bak.rename('contribuyentes_bak2', function(error, collection) {
      if (err) {
        enviarMail('[CCA] Error al renombrar contribuyentes_bak', 'Hubo un error al renombrar la colección contribuyentes_bak');
        console.error('Failed to rename contribuyentes_bak collection to contribuyentes_bak2...');
        throw err;
      }
      console.log('contribuyentes_bak collection renamed to contribuyentes_bak2...');

        console.log('Rename contribuyentes collection to contribuyentes_bak...');
        contribuyentes.rename('contribuyentes_bak', function(error, collection) {
          if (err) {
            enviarMail('[CCA] Error al eliminar contribuyentes', 'Hubo un error al renombrar la colección contribuyentes');
            console.error('Failed to rename contribuyentes collection to contribuyentes_bak...');
            throw err;
          }
          console.log('contribuyentes collection renamed to contribuyentes_bak...');

          console.log('Reading file line by line: ' + filepath);
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
                console.error('Failed to insert mongodb document');
                throw err;
              }
              // console.log('Contribuyente saved...');
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
    console.error('Failed to read previous file');
    return false;
  }
}

function enviarMail(subject, body) {
  console.log('enviarMail executed...');
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
  console.log('Executing transporter...');
  transporter.sendMail(mailOptions, function(error, info) {
    if (error) {
      return console.error(error);
    }
    console.log('Message sent: ' + info.response);
  });
}
