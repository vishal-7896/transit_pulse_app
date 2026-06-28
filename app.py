from flask import Flask,jsonify
from flask_cors import CORS

app=Flask(__name__)
CORS(app)
@app.route('/')
@app.route('/routes',methods = ['GET'])
def get_routes():
    return jsonify([{'id':1,'name':'Hapur-Delhi','start_terminus':'Hapur','end_terminus':'Delhi'},
                    {'id':2,'name':'Hapur-Noida','start_terminus':'Hapur','end_terminus':'Noida'},
                    {'id':3,'name':'Delhi-Noida','start_terminus':'Delhi','end_terminus':'Hapur'}])

if __name__ =="__main__":
    app.run(debug=True)