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
  assert = require('assert'),
  fs = require('fs'),
  fsCompareSync = require('fs-compare').sync,
  del = require('delete');

var mongodb_uri = 'mongodb://localhost/cca-development';

mongoose.connect(config.db);
var db = mongoose.connection;
db.on('error', function() {
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

  removeFilesJob();
  startJob();
});

var removeFilesJob = function() {
  var job = new CronJob({
    // cronTime: '0 31,51,11 * * * *',
    // cronTime: '27 * * * * *',
    cronTime: '0 55 * * * *',
    // cronTime: '0 46,01,16,31 * * * *',
    // cronTime: '0 16 * * * *',
    onTick: function() {
      console.log('Executing touch job... ' + moment().format('YYYYMMDDhhmmss'));

      del.sync(['/home/usuario/prj/consultasCuitAFIP/cca/downloads/*']);
    },
    onComplete: function() {
      console.log('Job touch finished...' + moment().format('YYYYMMDDhhmmss'));
    }
  });

  job.start();
}

var startJob = function() {
  var job = new CronJob({
    // cronTime: '0 31,51,11 * * * *',
    // cronTime: '30 * * * * *',
    cronTime: '0 0 * * * *',
    // cronTime: '0 46,01,16,31 * * * *',
    // cronTime: '0 16 * * * *',
    onTick: function() {
      console.log('Executing job... ' + moment().format('YYYYMMDDhhmmss'));
      downloadAndSaveData();
    },
    onComplete: function() {
        console.log('Job finished...' + moment().format('YYYYMMDDhhmmss'));
      }
      /*,
          start: true*/
  });

  job.start();
}

var downloadAndSaveData = function() {
  var file_uri = 'http://www.afip.gob.ar/genericos/cInscripcion/archivos/SINapellidoNombreDenominacion.zip';
  // var file_uri = 'http://localhost:3000/padr.zip';
  // var file_uri = 'http://localhost:3000/SINapellidoNombreDenominacion.zip';

  console.log('Downloading and decompressing AFIP zip file: ' + file_uri);
  var download = new Download({
    mode: '755',
    extract: true
  });
  var hoy = moment();
  // var anterior = moment(hoy).substract(1, 'days');
  // var anterior = moment(hoy).subtract(1, 'minutes');
  var anterior = moment(hoy).subtract(15, 'minutes');
  // var anterior = moment(hoy).subtract(15, 'minutes');
  download
    .get(file_uri)
    .dest('downloads')
    .rename('afip_contr_' + hoy.format('YYYYMMDDhhmm'))
    .run(function(err, files) {
      console.log("files.length: " + files.length);
      for (var i in files) {
        console.log("files[" + i + "].path: " + files[i].path);
      }
      // if (err || files.length !== 1) {
      if (err) {
        throw err;
      }
      console.log('Zip file downloaded and decompressed: ' + files[0].path);

      var filepathAnterior = files[0].path.replace(files[0].stem, '') + 'afip_contr_' + anterior.format('YYYYMMDDhhmm');
      if (fileExists(filepathAnterior)) {
        console.log("Already exists a previous file, comparing...");

        var modifiedTime = function(fileName, cb) {
          return fs.statSync(fileName).mtime;
        };
        var diff = fsCompareSync(modifiedTime, filepathAnterior, files[0].path);

        if (diff === 0) {
          console.log("Same files... ending...");
          return;
        }
      }
      saveData(files[0].path);
    });
}

var saveData = function(filepath) {
  var file = new LineReader(filepath);

  console.log('Connecting to mongodb server...');
  MongoClient.connect(mongodb_uri, function(err, db) {
    assert.equal(null, err);
    console.log('Connected correctly to mongodb server');

    console.log('Truncating collection...');
    var contribuyentes = db.collection('contribuyentes');
    contribuyentes.remove({});

    co(function*() {
      var line;
      console.log('Reading file and saving data...');
      while ((line = yield file.readLine()) !== null) {
        // console.log(line);
        saveContribuyente(line, db, function() {});
      }
      console.log('Data saved...');
      console.log('Closing mongo connection...');
      // db.close();
    });
  });
}

var saveContribuyente = function(line, db, callback) {
  if (line !== null && line !== "" && line.length > 0) {
    var contribuyentes = db.collection('contribuyentes');
    var vcuit = line.slice(0, 11);
    contribuyentes.insert({
      cuit: vcuit,
      impGanancias: line.slice(11, 13),
      impIva: line.slice(13, 15),
      monotributo: line.slice(15, 17),
      integranteSoc: line.slice(17, 18),
      empleador: line.slice(18, 19),
      actMonotributo: line.slice(19, 21)
    }, function(err, result) {
      assert.equal(err, null);
      // console.log('Contribuyente saved...');
      callback(result);
    });
  }
}

var fileExists = function fileExists(filepath) {
  console.log("fileExists executed: " + filepath)
  try {
    return fs.statSync(filepath).isFile();
  } catch (err) {
    return false;
  }
}
