# Contributing

- Backend: `cd backend && npm install && npm run dev`
- Frontend: `cd frontend && npm install && npm run dev`
- For bulk uploads: prepare a ZIP with folders per-game containing `index.html` and `metadata.json`

Example metadata.json:
{
  "title": "My Game",
  "description": "A fun learning game",
  "category": "math",
  "tags": ["addition","kiwi"],
  "lessonTitle": "Adding numbers",
  "lessonContent": "<p>...</p>",
  "quizzes": [{"question":"2+2?","options":["3","4"],"answerIndex":1}]
}
