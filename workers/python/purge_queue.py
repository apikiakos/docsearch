#!/usr/bin/env python3
"""Purge all messages from the RabbitMQ document queue"""
import os
import sys
from pathlib import Path
import pika

# Load environment variables from root .env file
try:
    from dotenv import load_dotenv
    root_dir = Path(__file__).parent.parent.parent
    env_path = root_dir / ".env"
    if env_path.exists():
        load_dotenv(env_path)
except ImportError:
    pass

QUEUE_NAME = "doc_ingest"
RABBITMQ_URL = os.environ.get("RABBITMQ_URL", "amqp://guest:guest@localhost:5672/")

def purge_queue():
    """Purge all messages from the document queue"""
    try:
        # Parse connection URL
        params = pika.URLParameters(RABBITMQ_URL)
        connection = pika.BlockingConnection(params)
        channel = connection.channel()
        
        # Declare queue to ensure it exists
        channel.queue_declare(queue=QUEUE_NAME, durable=True)
        
        # Get queue info before purging
        method = channel.queue_declare(queue=QUEUE_NAME, durable=True, passive=True)
        message_count = method.method.message_count
        
        if message_count == 0:
            print(f"Queue '{QUEUE_NAME}' is already empty")
            connection.close()
            return
        
        print(f"Found {message_count} message(s) in queue '{QUEUE_NAME}'")
        
        # Purge the queue
        channel.queue_purge(queue=QUEUE_NAME)
        
        print(f"✓ Purged {message_count} message(s) from queue '{QUEUE_NAME}'")
        
        connection.close()
        
    except Exception as e:
        print(f"✗ Error purging queue: {e}")
        sys.exit(1)

if __name__ == "__main__":
    print("Purging RabbitMQ queue...")
    print("=" * 60)
    purge_queue()
    print("=" * 60)
    print("✓ Done")

