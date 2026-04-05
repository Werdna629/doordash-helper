# DoorDash Grocery Credit Optimizer

## Context

You have two separate $10/month credits for DoorDash grocery orders (Chase Sapphire perk). The credits expire monthly and can't stack. The challenge: DoorDash prices are often higher than in-store, and fees (delivery + service) erode the credit's value. Manually comparing items across stores and optimizing carts is tedious. This tool automates that process.

**Key insight from research**: Pickup orders on DoorDash have **zero fees** — no delivery fee, no service fee, no tip needed. However, most grocery stores don't offer pickup, so the optimizer handles both cases.

## User Flow

1. **Configure stores**: Add your 3-4 grocery store URLs/IDs
2. **Build wishlist**: Type search terms like "milk", "bananas", "paper towels"
3. **Item matching**: For each search term, the app shows you search results from DoorDash. You pick the exact item you want (e.g., "Organic Whole Milk 1 Gal" not just "milk")
4. **Cross-store lookup**: Once you confirm an item, the app finds the same/equivalent item at your other stores and shows prices side-by-side
5. **Optimize one order**: The app recommends the cheapest cart for a single order, accounting for that store's specific fees and delivery thresholds
6. **Repeat next month** (or for your second credit): Same flow, one order at a time

This is a **single-order-at-a-time** flow — no need to optimize both credits simultaneously.

## Architecture Overview

**Tech stack**: TypeScript + Next.js (full-stack in one project)
- **Frontend**: Next.js App Router with React — simple web UI
- **Backend**: Next.js API routes — handles DoorDash interaction and optimization logic
- **Browser automation**: Patchright (stealth Playwright fork) — handles login and API calls
- **Why Next.js**: Single project, single deploy, good DX, React UI + API routes in one place

**How DoorDash interaction works** (based on existing open-source projects):
- DoorDash has no public API; their website uses internal GraphQL endpoints
- We run a headless browser (Patchright) that maintains a logged-in session
- All GraphQL calls execute inside the browser via `page.evaluate(fetch(...))` to inherit the correct TLS fingerprint and cookies
- Persistent browser profile preserves login state across restarts
- Key GraphQL operations: `convenienceSearchQuery` (search items), `storepageFeed` (store info)

## Project Structure

```
doordash-helper/
├── src/
│   ├── app/                      # Next.js App Router
│   │   ├── page.tsx              # Main UI — ties all components together
│   │   ├── layout.tsx
│   │   └── api/
│   │       ├── auth/route.ts     # GET: check auth, POST: trigger login
│   │       ├── stores/route.ts   # POST: look up store info from URL
│   │       ├── search/route.ts   # POST: search items, PUT: cross-store match
│   │       ├── optimize/route.ts # POST: run cart optimizer
│   │       └── debug/route.ts    # POST: capture GraphQL operations (dev tool)
│   ├── lib/
│   │   ├── browser.ts            # Patchright browser manager (singleton)
│   │   ├── doordash-api.ts       # DoorDash GraphQL client
│   │   ├── optimizer.ts          # Cart optimization algorithm
│   │   └── types.ts              # Shared TypeScript types
│   └── components/
│       ├── AuthStatus.tsx        # Login status & login button
│       ├── StoreSelector.tsx     # Add/remove grocery stores
│       ├── ItemPicker.tsx        # Search → confirm item → cross-store match
│       ├── PriceComparison.tsx   # Side-by-side price comparison table
│       └── OptimizationResults.tsx  # Ranked store recommendations
├── PLAN.md                       # This file
├── package.json
├── tsconfig.json
└── next.config.ts
```

## Key Design Decisions

### Item Matching Flow
1. User types "milk" → app searches their primary store
2. App shows top 10 results with name, price, image, size
3. User clicks to confirm the exact item they want
4. App searches other stores for the same item (by name)
5. Results shown side-by-side — user can accept/reject matches
6. Item added to wishlist with prices at all stores

### Cart Optimization Algorithm
- **Scope**: Optimizes a single order at a time
- **Per-store cost model** (fee thresholds detected per-store from the API):
  - **Pickup store**: `out_of_pocket = max(0, subtotal - $10 credit)` (no fees)
  - **Delivery store**: `out_of_pocket = max(0, subtotal + delivery_fee + service_fee - $10 credit)`
- **Strategies per store**:
  1. "All items" — buy everything available there
  2. "Smart subset" — buy only cheap items that are fully covered by credit (maximize free items)
- **Output**: Ranked recommendations sorted by out-of-pocket cost

### Fee Detection
Each store has different fee structures. The API client detects per-store:
- Pickup availability
- Free delivery threshold (e.g., $25, $35 — varies by store)
- Service fee rate and minimum
- Base delivery fee

## Setup & Running

```bash
# Install dependencies
npm install

# Install browser (required for DoorDash interaction)
npx patchright install chromium

# Run dev server
npm run dev
```

Then open http://localhost:3000.

### First-time setup:
1. Click "Log in to DoorDash" — a browser window opens
2. Log in with your DoorDash account
3. Close the browser — your session is saved locally
4. Add your grocery store URLs
5. Start searching and optimizing!

## GraphQL Query Discovery

The DoorDash GraphQL queries in `doordash-api.ts` are based on known operations. If they stop working (DoorDash changes their API), use the debug endpoint:

```bash
curl -X POST http://localhost:3000/api/debug \
  -H "Content-Type: application/json" \
  -d '{"storeUrl": "https://www.doordash.com/convenience/store/YOUR_STORE_ID/"}'
```

This navigates to the store page in the browser, captures all GraphQL operations, and returns them. Use these to update the queries in `doordash-api.ts`.

## Future Enhancements
- In-store price comparison (show true savings vs going to the store yourself)
- Auto-detect nearby grocery stores instead of manual store URLs
- Price history tracking
- Calendar reminders for monthly credit usage
- One-click add-to-cart on DoorDash (via browser automation)
- Support for the $5 restaurant credit too
- Save confirmed item matches so you don't have to re-confirm every month
