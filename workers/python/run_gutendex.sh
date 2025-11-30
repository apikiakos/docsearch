#!/bin/bash
# Helper script to run gutendex_producer with virtual environment activated

cd "$(dirname "$0")"
source venv/bin/activate
python gutendex_producer.py "$@"

