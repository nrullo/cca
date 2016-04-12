// Example model

var mongoose = require('mongoose'),
  Schema = mongoose.Schema;

var ContribuyenteSchema = new Schema({
  cuit: String,
  impGanancias: String,
  impIva: String,
  monotributo: String,
  integranteSoc: String,
  empleador: String,
  actMonotributo: String
});

ContribuyenteSchema.virtual('date')
  .get(function(){
    return this._id.getTimestamp();
  });

var ContribuyenteModel = mongoose.model('Contribuyente', ContribuyenteSchema);

module.exports = ContribuyenteModel;
