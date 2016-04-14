var express = require('express'),
  config = require('./config/config'),
  moment = require('moment'),
  Download = require('download'),
  CronJob = require('cron').CronJob,
  mongoose = require('mongoose'),
  glob = require('glob'),
  co = require('co'),
  LineByLineReader = require('line-by-line'),
  LineReader = require('line-by-line-promise'),
  MongoClient = require('mongodb').MongoClient,
  assert = require('assert'),
  fs = require('fs'),
  fsCompareSync = require('fs-compare').sync,
  del = require('delete');

var db;

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

  console.log('Connecting to mongodb server...');
  MongoClient.connect(mongodb_uri, function(err, database) {
    assert.equal(null, err);
    assert.ok(database != null);
    if (err) throw err;
    console.log('Connected correctly to mongodb server');
    db = database;

    removeFilesJob.start();
    startJob.start();
  });
});

var removeFilesJob = new CronJob({
  // cronTime: '0 31,51,11 * * * *',
  // cronTime: '20 * * * * *',
  // cronTime: '30 8,18,28,38,48,58 * * * *',
  // cronTime: '20,50 * * * * *',
  // cronTime: '0 15,35,55 * * * *',
  cronTime: '0 55 * * * *',
  // cronTime: '0 46,01,16,31 * * * *',
  // cronTime: '0 16 * * * *',
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
  cronTime: '0 0 * * * *',
  // cronTime: '0 46,01,16,31 * * * *',
  // cronTime: '0 16 * * * *',
  onTick: function() {
    console.log('Executing startJob job... ' + moment().format('YYYYMMDDhhmmss'));

    downloadAndSaveData();
  },
  onComplete: function() {
    console.log('Job startJob finished...' + moment().format('YYYYMMDDhhmmss'));
  }
});

var downloadAndSaveData = function() {
  var file_uri = 'http://www.afip.gob.ar/genericos/cInscripcion/archivos/SINapellidoNombreDenominacion.zip';
  // var file_uri = 'http://localhost:3000/SINapellidoNombreDenominacion.zip';
  // var file_uri = 'http://localhost:3000/padr.zip';
  // var file_uri = 'http://localhost:3000/xaa10mil.zip';
  // var file_uri = 'http://localhost:3000/xaa100mil.zip';
  // var file_uri = 'http://localhost:3000/xaa1millon.zip';

  console.log('Downloading and decompressing AFIP zip file: ' + file_uri);
  var download = new Download({
    mode: '755',
    extract: true
  });
  var hoy = moment();
  // var anterior = moment(hoy).substract(1, 'days');
  var anterior = moment(hoy).substract(1, 'hours');
  // var anterior = moment(hoy).subtract(10, 'minutes');
  // var anterior = moment(hoy).subtract(30, 'seconds');
  // var anterior = moment(hoy).subtract(15, 'minutes');
  // var anterior = moment(hoy).subtract(20, 'minutes');
  download
    .get(file_uri)
    .dest('downloads')
    .rename('afip_contr_' + hoy.format('YYYYMMDDhhmmss'))
    .run(function(err, files) {
      // if (err || files.length !== 1) {
      if (err) {
        console.error('Failed to download zip file...');
        throw err;
      }
      console.log('Zip file downloaded and decompressed: ' + files[0].path);

      // console.log('files.length: ' + files.length);
      // for (var i in files) {
      //   console.log('files[' + i + '].path: ' + files[i].path);
      // }

      // var filepathAnterior = files[0].path.replace(files[0].stem, '') + 'afip_contr_' + anterior.format('YYYYMMDDhhmm');
      var filepathAnterior = files[0].path.replace(files[0].stem, '') + 'afip_contr_' + anterior.format('YYYYMMDDhhmmss');
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
    if (err) throw err;
    console.log('Documentes removed...');

    console.log('Reading file line by line: ' + filepath);
    /*
    var lr = new LineByLineReader(filepath);

    lr.on('error', function(err) {
      console.log('Error when trying to read file line by line...');
    });

    lr.on('line', function(line) {
      var o = parseLineToObject(line);
      if (o !== null) {
        saveContribuyente(o);
      }
    });

    lr.on('end', function() {
      console.log('All lines are readed...');
    });
    */
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
          cuit: line.slice(0, 11),
          impGanancias: line.slice(11, 13),
          impIva: line.slice(13, 15),
          monotributo: line.slice(15, 17),
          integranteSoc: line.slice(17, 18),
          empleador: line.slice(18, 19),
          actMonotributo: line.slice(19, 21)
        };
      }
      return rval;
    }

    function saveContribuyente(c) {
      contribuyentes.insert(c, function(err, result) {
        assert.equal(err, null);
        console.log('Contribuyente saved...');
      });
    }

  });
}

function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch (err) {
    return false;
  }
}
