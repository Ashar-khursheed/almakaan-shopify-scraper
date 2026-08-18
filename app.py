import os
import asyncio
import json
from io import BytesIO, StringIO
import pandas as pd
from fastapi import FastAPI, BackgroundTasks, Query, Response
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from scraper import scraper_instance

app = FastAPI(title="Shopify Product Scraper & Dashboard", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")

if not os.path.exists(STATIC_DIR):
    os.makedirs(STATIC_DIR)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

class ScrapeRequest(BaseModel):
    url: str = "https://almakaanstore.com/collections/kitchen-tools"

@app.get("/", response_class=HTMLResponse)
def read_root():
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse(content="<h1>Dashboard loading error: index.html not found.</h1>")

@app.post("/api/start-scrape")
def start_scrape(req: ScrapeRequest, background_tasks: BackgroundTasks):
    if scraper_instance.is_running:
        return {"status": "error", "message": "Scraper is already running!"}
    
    target_url = req.url.strip()
    if not target_url:
        target_url = "https://almakaanstore.com/collections/kitchen-tools"

    # Start scraping thread in background
    background_tasks.add_task(scraper_instance.run_scrape, target_url)
    return {"status": "success", "message": f"Scraping started for {target_url}"}

@app.post("/api/stop-scrape")
def stop_scrape():
    if not scraper_instance.is_running:
        return {"status": "error", "message": "Scraper is not running."}
    
    scraper_instance.stop()
    return {"status": "success", "message": "Stop signal sent to scraper."}

@app.get("/api/status")
def get_status():
    return scraper_instance.get_state()

@app.get("/api/stream-progress")
async def stream_progress():
    async def event_generator():
        while True:
            state = scraper_instance.get_state()
            yield f"data: {json.dumps(state)}\n\n"
            await asyncio.sleep(0.5)

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@app.get("/api/stats")
def get_stats():
    with scraper_instance._lock:
        items = list(scraper_instance.products_data)

    total = len(items)
    if total == 0:
        return {
            "total": 0,
            "in_stock": 0,
            "out_of_stock": 0,
            "avg_price": 0.0,
            "vendors_count": 0
        }

    in_stock = sum(1 for i in items if i.get('in_stock'))
    out_of_stock = total - in_stock
    total_price = sum(i.get('price_min', 0.0) for i in items)
    vendors = len(set(i.get('vendor') for i in items if i.get('vendor')))

    return {
        "total": total,
        "in_stock": in_stock,
        "out_of_stock": out_of_stock,
        "avg_price": round(total_price / total, 2),
        "vendors_count": vendors
    }

@app.get("/api/products")
def get_products(
    search: str = Query("", description="Search term for title, SKU, vendor"),
    vendor: str = Query("", description="Filter by vendor"),
    stock_status: str = Query("", description="Filter by stock status (In Stock / Out of Stock)"),
    sort_by: str = Query("id", description="Sort field: title, price_min, discount_percentage, variant_count"),
    order: str = Query("asc", description="Sort order: asc or desc"),
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=10000)
):
    with scraper_instance._lock:
        items = list(scraper_instance.products_data)

    # 1. Filter by search
    if search:
        s = search.lower().strip()
        items = [
            i for i in items if (
                s in i['title'].lower() or 
                s in i['vendor'].lower() or 
                s in i['primary_sku'].lower() or 
                s in i['tags_str'].lower()
            )
        ]

    # 2. Filter by vendor
    if vendor:
        items = [i for i in items if i['vendor'].lower() == vendor.lower()]

    # 3. Filter by stock status
    if stock_status:
        items = [i for i in items if i['stock_status'].lower() == stock_status.lower()]

    # 4. Vendors summary list for filter dropdown
    all_vendors = sorted(list(set([i['vendor'] for i in scraper_instance.products_data if i.get('vendor')])))

    # 5. Sorting
    reverse = (order.lower() == "desc")
    if sort_by in ["title", "vendor", "stock_status"]:
        items.sort(key=lambda x: str(x.get(sort_by, '')).lower(), reverse=reverse)
    elif sort_by in ["price_min", "price_max", "discount_percentage", "variant_count", "images_count"]:
        items.sort(key=lambda x: float(x.get(sort_by, 0.0) or 0.0), reverse=reverse)

    total_matched = len(items)
    start_idx = (page - 1) * limit
    end_idx = start_idx + limit
    paginated_items = items[start_idx:end_idx]

    return {
        "total": total_matched,
        "total_unfiltered": len(scraper_instance.products_data),
        "page": page,
        "limit": limit,
        "total_pages": (total_matched + limit - 1) // limit if total_matched > 0 else 1,
        "vendors": all_vendors,
        "products": paginated_items
    }

import tempfile

TEMP_DIR = tempfile.gettempdir()

@app.get("/api/export/csv")
def export_csv():
    df = scraper_instance.export_to_dataframe()
    file_path = os.path.join(TEMP_DIR, "almakaan_kitchen_tools_scraped.csv")
    
    with open(file_path, "w", encoding="utf-8-sig", newline="") as f:
        df.to_csv(f, index=False)
    
    return FileResponse(
        path=file_path,
        filename="almakaan_kitchen_tools_scraped.csv",
        media_type="text/csv"
    )

@app.get("/api/export/xlsx")
def export_xlsx():
    df = scraper_instance.export_to_dataframe()
    file_path = os.path.join(TEMP_DIR, "almakaan_kitchen_tools_scraped.xlsx")
    
    with pd.ExcelWriter(file_path, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='Kitchen Tools Scraped')
    
    return FileResponse(
        path=file_path,
        filename="almakaan_kitchen_tools_scraped.xlsx",
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )

@app.get("/api/export/json")
def export_json():
    with scraper_instance._lock:
        data = list(scraper_instance.products_data)
    
    file_path = os.path.join(TEMP_DIR, "almakaan_kitchen_tools_scraped.json")
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    
    return FileResponse(
        path=file_path,
        filename="almakaan_kitchen_tools_scraped.json",
        media_type="application/json"
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
