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

    // removeFilesJob.start();
    startJob.start();
  });
});

var removeFilesJob = new CronJob({
  // cronTime: '0 31,51,11 * * * *',
  cronTime: '20 * * * * *',
  // cronTime: '30 8,18,28,38,48,58 * * * *',
  // cronTime: '20,50 * * * * *',
  // cronTime: '0 15,35,55 * * * *',
  // cronTime: '5 * * * * *',
  // cronTime: '0 46,01,16,31 * * * *',
  // cronTime: '0 0 * * * *',
  onTick: function() {
    console.log('Executing removeFilesJob job... ' + moment().format('YYYYMMDDhhmmss'));

    del.sync(['/home/usuario/prj/consultasCuitAFIP/cca/downloads/*']);
  },
  onComplete: function() {
    console.log('Job removeFilesJob finished...' + moment().format('YYYYMMDDhhmmss'));
  }
});

var startJob = new CronJob({
  // cronTime: '0 31,51,11 * * * *',
  // cronTime: '30 * * * * *',
  // cronTime: '30 0,10,20,30,40,50 * * * *',
  // cronTime: '0,30 * * * * *',
  // cronTime: '0 0,20,40 * * * *',
  // cronTime: '0 0 * * * *',
  // cronTime: properties.get('cron.rule'),
  // cronTime: '0 46,01,16,31 * * * *',
  cronTime: '30 12 * * * *',
  onTick: function() {
    console.log('Executing startJob job... ' + moment().format('YYYYMMDDhhmmss'));

    downloadAndSaveData();
  },
  onComplete: function() {
    console.log('Job startJob finished...' + moment().format('YYYYMMDDhhmmss'));
  }
});

var downloadAndSaveData = function() {
  console.log('Downloading and decompressing AFIP zip file: ' + properties.get('afip.uri'));
  var download = new Download({
    mode: '755',
    extract: true
  });
  var hoy = moment();
  // var anterior = moment(hoy).subtract(1, 'days');
  var anterior = moment(hoy).subtract(1, 'hours');
  // var anterior = moment(hoy).subtract(1, 'minutes');
  // var anterior = moment(hoy).subtract(30, 'seconds');
  // var anterior = moment(hoy).subtract(15, 'minutes');
  // var anterior = moment(hoy).subtract(20, 'minutes');
  download
    .get(properties.get('afip.uri'))
    .dest('downloads')
    .rename('afip_contr_' + hoy.format('YYYYMMDDhhmmss'))
    .run(function(err, files) {
      // if (err || files.length !== 1) {
      if (err) {
        enviarMail('[CCA] Failed to download zip file...', 'Failed to download zip file...');
        console.error('Failed to download zip file...');
        throw err;
      }
      console.log('Zip file downloaded and decompressed: ' + files[0].path);

      // var filepathAnterior = files[0].path.replace(files[0].stem, '') + 'afip_contr_' + anterior.format('YYYYMMDDhhmm');
      var filepathAnterior = files[0].path.replace(files[0].stem, '') + 'afip_contr_' + anterior.format('YYYYMMDDhhmmss');
      // var filepathAnterior = '';
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
}

var saveData = function(filepath) {

  var contribuyentes = db.collection('contribuyentes');
  console.log('Removing documents...');
  contribuyentes.remove({}, function(err) {
    if (err) {
      enviarMail('[CCA] Failed to remove mongodb documents...', 'Failed to remove mongodb documents....');
      console.error('Failed to remove mongodb documents');
      throw err;
    }
    console.log('Documentes removed...');

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
          /*impGanancias: line.slice(11, 13).trim(),*/
          impIva: line.slice(13, 15).trim(),
          monotributo: line.slice(15, 17).trim()/*,
          integranteSoc: line.slice(17, 18).trim(),
          empleador: line.slice(18, 19).trim(),
          actMonotributo: line.slice(19, 21).trim()*/
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
}

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
