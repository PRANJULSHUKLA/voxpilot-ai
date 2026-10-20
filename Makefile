test:
	cd backend && ../.venv/bin/python -m pytest
	cd frontend && npm test

check:
	.venv/bin/ruff check backend
	cd frontend && npm run build

up:
	docker compose up --build -d

down:
	docker compose down
