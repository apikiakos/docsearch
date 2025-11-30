# Quick Reference

## Common Commands

### Install Dependencies
```bash
cd workers/python
source venv/bin/activate
pip install -r requirements.txt  # Note: -r flag is required!
```

### Run Producer (Local Files)
```bash
source venv/bin/activate
python producer.py /path/to/folder tenant-id
```

### Run HTTP Producer
```bash
source venv/bin/activate
python http_producer.py https://example.com/doc.txt tenant-id
```

### Run Gutendex Producer
```bash
source venv/bin/activate
python gutendex_producer.py 50  # Process 50 books
# OR use helper script:
./run_gutendex.sh 50
```

### Run Consumer
```bash
source venv/bin/activate
python consumer.py
```

## Virtual Environment

**Always activate the virtual environment first:**
```bash
cd workers/python
source venv/bin/activate
```

You'll see `(venv)` in your prompt when it's activated.

**To deactivate:**
```bash
deactivate
```

## Common Issues

### "ModuleNotFoundError: No module named 'pika'"
- Solution: Activate venv and install dependencies
  ```bash
  source venv/bin/activate
  pip install -r requirements.txt
  ```

### "ERROR: Could not find a version that satisfies the requirement requirements.txt"
- Solution: Use `-r` flag: `pip install -r requirements.txt` (not `pip install requirements.txt`)

### Consumer not processing messages
- Check RabbitMQ is running: `docker compose ps`
- Check queue has messages: http://localhost:15672
- Verify consumer is connected and waiting for messages

## Environment Variables

```bash
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/docsearch"
export RABBITMQ_URL="amqp://guest:guest@localhost:5672/"
export ELASTIC_URL="http://localhost:9200"
export GUTENBERG_TENANT_ID="gutenberg"
export GUTENDEX_DELAY="2.0"
export MAX_BOOKS="100"
```

