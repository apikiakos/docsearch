# How to Stop a Running Producer in Production

If a producer (especially Gutenberg) is running and won't stop, here's how to kill it.

## Quick Commands

### 1. Find the Producer Process

```bash
# Find all Python processes related to gutenberg_producer
ps aux | grep gutenberg_producer

# Or find all Python processes
ps aux | grep python | grep producer

# Or find processes by FastAPI
ps aux | grep fastapi
```

### 2. Kill the Producer Process

Once you find the process ID (PID), kill it:

```bash
# Replace <PID> with the actual process ID
kill <PID>

# If that doesn't work, force kill:
kill -9 <PID>
```

### 3. Kill All Gutenberg Producer Processes

```bash
# Kill all gutenberg_producer processes
pkill -f gutenberg_producer.py

# Force kill if needed
pkill -9 -f gutenberg_producer.py
```

### 4. Kill All Producer Processes

```bash
# Kill all producer processes
pkill -f "_producer.py"

# Force kill if needed
pkill -9 -f "_producer.py"
```

### 5. Restart FastAPI Service

After killing the producer, restart FastAPI to clean up:

```bash
pm2 restart distributed-docsearch-fastapi
# or
pm2 restart docsearch-fastapi
```

## Complete Stop Script

Save this as `stop_producer.sh`:

```bash
#!/bin/bash

echo "🔍 Finding producer processes..."
ps aux | grep -E "(gutenberg_producer|s3_producer|uploads_producer|govdocs_producer)" | grep -v grep

echo ""
read -p "Kill all producer processes? (y/N): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🛑 Killing producer processes..."
    pkill -f "_producer.py"
    sleep 2
    
    # Force kill if still running
    if pgrep -f "_producer.py" > /dev/null; then
        echo "⚠️  Some processes still running, force killing..."
        pkill -9 -f "_producer.py"
    fi
    
    echo "✅ Producer processes stopped"
    
    # Restart FastAPI
    echo "🔄 Restarting FastAPI service..."
    pm2 restart distributed-docsearch-fastapi || pm2 restart docsearch-fastapi
    
    echo "✅ Done!"
else
    echo "Cancelled."
fi
```

Make it executable:
```bash
chmod +x stop_producer.sh
```

## Alternative: Stop via PM2

If the producer was started via PM2 (unlikely but possible):

```bash
# List all PM2 processes
pm2 list

# Stop specific process
pm2 stop <process-name>

# Delete process
pm2 delete <process-name>
```

## Check if Producer is Still Running

```bash
# Check for producer processes
ps aux | grep producer | grep -v grep

# Check FastAPI logs
pm2 logs distributed-docsearch-fastapi --lines 50

# Check if any Python processes are using CPU
top -p $(pgrep -d',' -f python)
```

## Emergency: Kill All Python Processes (⚠️ DANGEROUS)

**WARNING**: This will kill ALL Python processes, including FastAPI, consumer, etc. Only use as last resort!

```bash
# List what will be killed first
ps aux | grep python

# Kill all Python processes (DANGEROUS!)
pkill python

# Force kill (VERY DANGEROUS!)
pkill -9 python

# Then restart all services
pm2 restart all
```

## Prevention: Add Timeout to Producer

To prevent producers from running indefinitely, the FastAPI service already has a 10-minute timeout. If you need a shorter timeout, you can modify `fastapi_service.py`:

```python
timeout=600,  # 10 minutes - change to smaller value if needed
```

## Check RabbitMQ Queue

After stopping the producer, check if messages are still being queued:

```bash
# Access RabbitMQ Management UI
# http://your-server:15672 (guest/guest)

# Or via command line
rabbitmqctl list_queues name messages
```

The consumer will continue processing messages that are already in the queue, but no new messages will be added once the producer is stopped.

