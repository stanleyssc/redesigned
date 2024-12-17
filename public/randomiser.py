from flask import Flask, request, jsonify
from flask_cors import CORS
import secrets


app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

cardSet = [
    "circle_1.png", "circle_2.png", "circle_3.png", "circle_4.png", "circle_5.png",
    "circle_7.png", "circle_8.png", "circle_10.png", "circle_11.png", "circle_12.png",
    "circle_13.png", "circle_14.png", "triangle_1.png", "triangle_2.png", "triangle_3.png",
    "triangle_4.png", "triangle_5.png", "triangle_7.png", "triangle_8.png", "triangle_10.png",
    "triangle_11.png", "triangle_12.png", "triangle_13.png", "triangle_14.png", "cross_1.png",
    "cross_2.png", "cross_3.png", "cross_5.png", "cross_7.png", "cross_10.png", "cross_11.png",
    "cross_13.png", "cross_14.png", "square_1.png", "square_2.png", "square_3.png", "square_5.png",
    "square_7.png", "square_10.png", "square_11.png", "square_13.png", "square_14.png",
    "star_1.png", "star_2.png", "star_3.png", "star_4.png", "star_5.png", "star_7.png",
    "star_8.png", "whot_20.png",
]

@app.route('/getCards', methods=['POST'])
def get_cards():
    try:
        data = request.json
        num_panels = int(data.get('numPanels', 0))

        if num_panels <= 0 or num_panels > len(cardSet):
            return jsonify({"error": "Invalid number of panels"}), 400

        selected_cards = secrets.SystemRandom().sample(cardSet, num_panels)
        return jsonify({"cards": selected_cards})

    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True)
