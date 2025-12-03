"""FastAPI service for triggering producers"""
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import subprocess
import sys
from pathlib import Path
import os
import threading

# Load environment variables
try:
    from dotenv import load_dotenv
    root_dir = Path(__file__).parent.parent.parent
    env_path = root_dir / ".env"
    if env_path.exists():
        load_dotenv(env_path)
except ImportError:
    pass

app = FastAPI(title="Document Search Producers API")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://docsearch.petesampler.com"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ProducerRequest(BaseModel):
    tenant: Optional[str] = None
    checkExisting: Optional[bool] = False
    forceReindex: Optional[bool] = False
    fetchNew: Optional[int] = None
    reindexDocument: Optional[str] = None  # Path to specific document to reindex


class ProducerResponse(BaseModel):
    success: bool
    message: str
    tenant: Optional[str] = None


def run_producer_script(
    script_name: str, 
    tenant: Optional[str] = None,
    check_existing: bool = False,
    force_reindex: bool = False,
    fetch_new: Optional[int] = None,
    reindex_document: Optional[str] = None
) -> tuple[bool, str]:
    """Run a producer script and return success status and output"""
    script_path = Path(__file__).parent / script_name
    
    if not script_path.exists():
        return False, f"Script {script_name} not found at {script_path}"
    
    try:
        # Build command
        cmd = [sys.executable, str(script_path)]
        
        # Add tenant if provided (for S3 producer or uploads producer)
        if tenant:
            if script_name == "s3_producer.py":
                cmd.append(tenant)
            elif script_name == "uploads_producer.py":
                cmd.append("--tenant")
                cmd.append(tenant)
        
        # Add mode flags (mutually exclusive priorities: reindexDocument > forceReindex > checkExisting)
        if reindex_document:
            cmd.append("--reindex-document")
            cmd.append(reindex_document)
        elif force_reindex:
            cmd.append("--force-reindex")
        elif check_existing:
            cmd.append("--check-existing")
        
        if fetch_new is not None:
            cmd.append("--fetch-new")
            cmd.append(str(fetch_new))
        
        print(f"[fastapi] Running command: {' '.join(cmd)}")
        print(f"[fastapi] Working directory: {script_path.parent}")
        
        # Run script
        # Use DEVNULL for stdin to ensure it's not detected as a TTY (prevents confirmation prompts)
        result = subprocess.run(
            cmd,
            stdin=subprocess.DEVNULL,  # Prevent interactive prompts
            capture_output=True,
            text=True,
            timeout=600,  # 10 minute timeout (longer for checking existing docs)
            cwd=str(script_path.parent),
            env={**os.environ}  # Pass environment variables
        )
        
        # Print output for debugging
        if result.stdout:
            print(f"[fastapi] STDOUT:\n{result.stdout}")
        if result.stderr:
            print(f"[fastapi] STDERR:\n{result.stderr}")
        print(f"[fastapi] Return code: {result.returncode}")
        
        if result.returncode == 0:
            output = result.stdout or "Producer completed successfully"
            return True, output
        else:
            error_output = result.stderr or result.stdout or f"Producer failed with code {result.returncode}"
            # Combine both stdout and stderr for better debugging
            if result.stdout and result.stderr:
                error_output = f"STDOUT: {result.stdout}\nSTDERR: {result.stderr}"
            elif result.stdout:
                error_output = result.stdout
            elif result.stderr:
                error_output = result.stderr
            return False, error_output
    
    except subprocess.TimeoutExpired:
        print(f"[fastapi] Producer timed out after 10 minutes")
        return False, "Producer timed out after 10 minutes"
    except Exception as e:
        print(f"[fastapi] Exception running producer: {str(e)}")
        import traceback
        traceback.print_exc()
        return False, f"Error running producer: {str(e)}"


@app.get("/health")
async def health():
    """Health check endpoint"""
    return {"status": "ok", "service": "producers-api"}


@app.post("/producer/gutenberg", response_model=ProducerResponse)
async def trigger_gutenberg_producer(request: ProducerRequest, background_tasks: BackgroundTasks):
    """Trigger Gutenberg producer (non-blocking)"""
    print(f"[fastapi] Received Gutenberg producer request:")
    print(f"  - checkExisting: {request.checkExisting}")
    print(f"  - forceReindex: {request.forceReindex}")
    print(f"  - fetchNew: {request.fetchNew}")
    print(f"  - reindexDocument: {request.reindexDocument}")
    
    # Run producer in background task to avoid blocking
    def run_producer():
        run_producer_script(
            "gutenberg_producer.py",
            tenant=None,  # Gutenberg producer doesn't accept tenant argument
            check_existing=request.checkExisting if request.checkExisting else False,
            force_reindex=request.forceReindex if request.forceReindex else False,
            fetch_new=request.fetchNew,
            reindex_document=request.reindexDocument
        )
    
    background_tasks.add_task(run_producer)
    
    # Return immediately
    return ProducerResponse(
        success=True,
        message="Producer started in background. Check logs for progress.",
        tenant="gutenberg"
    )


@app.post("/producer/s3", response_model=ProducerResponse)
async def trigger_s3_producer(request: ProducerRequest, background_tasks: BackgroundTasks):
    """Trigger S3 producer for a specific tenant (non-blocking)"""
    if not request.tenant and not request.reindexDocument:
        raise HTTPException(status_code=400, detail="tenant is required (unless reindexing a specific document)")
    
    # Run producer in background task to avoid blocking
    def run_producer():
        run_producer_script(
            "s3_producer.py",
            tenant=request.tenant,
            check_existing=request.checkExisting or False,
            force_reindex=request.forceReindex or False,
            fetch_new=request.fetchNew,
            reindex_document=request.reindexDocument
        )
    
    background_tasks.add_task(run_producer)
    
    # Return immediately
    return ProducerResponse(
        success=True,
        message="Producer started in background. Check logs for progress.",
        tenant=request.tenant
    )


@app.post("/producer/uploads", response_model=ProducerResponse)
async def trigger_uploads_producer(request: ProducerRequest, background_tasks: BackgroundTasks):
    """Trigger uploads producer (scans uploads/{tenant}/ folder for specific tenant, or all tenants if none specified) - non-blocking"""
    tenant = request.tenant
    
    # Run producer in background task to avoid blocking
    def run_producer():
        run_producer_script("uploads_producer.py", tenant=tenant)
    
    background_tasks.add_task(run_producer)
    
    # Return immediately
    return ProducerResponse(
        success=True,
        message=f"Producer started in background for {'tenant ' + tenant if tenant else 'all tenants'}. Check logs for progress.",
        tenant=tenant
    )


@app.post("/producer/govdocs", response_model=ProducerResponse)
async def trigger_govdocs_producer(request: ProducerRequest, background_tasks: BackgroundTasks):
    """Trigger GovDocs producer (non-blocking)"""
    # GovDocs producer takes folder as first argument, not tenant
    # It uses a default folder if not provided
    # Run producer in background task to avoid blocking
    def run_producer():
        run_producer_script(
            "govdocs_producer.py",
            tenant=None,  # GovDocs producer doesn't accept tenant argument (uses folder instead)
            check_existing=request.checkExisting or False,
            force_reindex=request.forceReindex or False,
            fetch_new=request.fetchNew,
            reindex_document=request.reindexDocument
        )
    
    background_tasks.add_task(run_producer)
    
    # Return immediately
    return ProducerResponse(
        success=True,
        message="Producer started in background. Check logs for progress.",
        tenant="govdocs"
    )


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("FASTAPI_PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)

