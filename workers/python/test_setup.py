"""Quick test script to verify setup"""
import sys

def test_imports():
    """Test that all required packages are installed"""
    print("Testing imports...")
    
    try:
        import pika
        print("✓ pika installed")
    except ImportError:
        print("✗ pika not installed - run: pip install pika")
        return False
    
    try:
        import elasticsearch
        print("✓ elasticsearch installed")
    except ImportError:
        print("✗ elasticsearch not installed - run: pip install elasticsearch")
        return False
    
    try:
        from elasticsearch import helpers
        print("✓ elasticsearch.helpers available")
    except ImportError:
        print("✗ elasticsearch.helpers not available")
        return False
    
    return True


def test_connections():
    """Test connections to RabbitMQ and Elasticsearch"""
    print("\nTesting connections...")
    
    # Test RabbitMQ
    try:
        import pika
        params = pika.URLParameters("amqp://guest:guest@localhost:5672/")
        connection = pika.BlockingConnection(params)
        connection.close()
        print("✓ RabbitMQ connection successful")
    except Exception as e:
        print(f"✗ RabbitMQ connection failed: {e}")
        print("  Make sure RabbitMQ is running: docker compose up -d")
        return False
    
    # Test Elasticsearch
    try:
        from elasticsearch import Elasticsearch
        es = Elasticsearch("http://localhost:9200", request_timeout=5)
        # Try ping first
        try:
            ping_result = es.ping()
            if ping_result:
                print("✓ Elasticsearch connection successful")
            else:
                # If ping returns False, try info() as fallback
                info = es.info()
                print("✓ Elasticsearch connection successful (via info)")
        except Exception as ping_error:
            # If ping fails, try info() as fallback
            try:
                info = es.info()
                print("✓ Elasticsearch connection successful (via info)")
            except Exception as info_error:
                print(f"✗ Elasticsearch connection failed")
                print(f"  Ping error: {ping_error}")
                print(f"  Info error: {info_error}")
                print("  Make sure Elasticsearch is running: docker compose up -d")
                print("  Check: curl http://localhost:9200")
                return False
    except ImportError as e:
        print(f"✗ Elasticsearch module not found: {e}")
        print("  Install: pip install elasticsearch")
        return False
    except Exception as e:
        print(f"✗ Elasticsearch connection failed: {e}")
        print("  Make sure Elasticsearch is running: docker compose up -d")
        print("  Check: curl http://localhost:9200")
        return False
    
    return True


def main():
    print("=" * 50)
    print("Document Ingestion Setup Test")
    print("=" * 50)
    
    if not test_imports():
        print("\n❌ Import test failed. Install dependencies:")
        print("   pip install -r requirements.txt")
        sys.exit(1)
    
    if not test_connections():
        print("\n❌ Connection test failed. Start services:")
        print("   docker compose up -d")
        sys.exit(1)
    
    print("\n" + "=" * 50)
    print("✅ All tests passed! Setup is ready.")
    print("=" * 50)
    print("\nNext steps:")
    print("1. Start consumer: python consumer.py")
    print("2. Run producer: python producer.py <folder> <tenant_id>")


if __name__ == "__main__":
    main()

