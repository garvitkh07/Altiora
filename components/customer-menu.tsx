"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "@/components/feedback";
import { Icon } from "@/components/icon";
import { OrderCart, type CartLine } from "@/components/order-cart";
import {
  getRestaurantMenu,
  submitOrder,
  type MenuCategory,
  type MenuItem,
  type OrderConfirmation,
  type RestaurantMenu,
} from "@/lib/data";

interface CustomerMenuProps {
  restaurantSlug: string;
  tableToken: string;
}

type LoadStatus = "loading" | "ready" | "error";

function formatPrice(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function categoryKey(item: MenuItem) {
  return item.categoryId || item.categoryName || "uncategorized";
}

function categoryLabel(item: MenuItem) {
  return item.categoryName || "Menu";
}

function buildCategories(menu: RestaurantMenu): MenuCategory[] {
  if (menu.categories.length > 0) {
    return menu.categories;
  }

  const seen = new Set<string>();
  return menu.items.reduce<MenuCategory[]>((categories, item) => {
    const id = categoryKey(item);
    if (!seen.has(id)) {
      seen.add(id);
      categories.push({ id, name: categoryLabel(item) });
    }
    return categories;
  }, []);
}

function MenuItemCard({
  item,
  currency,
  quantity,
  onAdd,
}: {
  item: MenuItem;
  currency: string;
  quantity: number;
  onAdd: () => void;
}) {
  const unavailable = item.isAvailable === false;
  const initial = item.name.trim().charAt(0).toUpperCase() || "A";

  return (
    <article className={`menu-card ${unavailable ? "opacity-60" : ""}`}>
      <div
        aria-label={item.imageUrl ? `${item.name} image` : undefined}
        className="menu-card-art"
        role={item.imageUrl ? "img" : undefined}
        style={item.imageUrl ? { backgroundImage: `url(${item.imageUrl})` } : undefined}
      >
        {!item.imageUrl ? <span>{initial}</span> : null}
        {unavailable ? <span className="menu-card-badge">Sold out</span> : null}
      </div>
      <div className="flex flex-1 flex-col px-4 pb-4 pt-4 sm:px-5 sm:pb-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-xl leading-tight text-ink">{item.name}</h3>
            {item.isVegetarian ? <p className="mt-1 text-xs font-semibold uppercase tracking-[0.13em] text-sage-dark">Vegetarian</p> : null}
          </div>
          <p className="shrink-0 text-sm font-semibold text-sage-dark">{formatPrice(item.price, currency)}</p>
        </div>
        {item.description ? <p className="mt-3 line-clamp-3 text-sm leading-6 text-muted">{item.description}</p> : null}
        <button
          aria-label={unavailable ? `${item.name} is sold out` : `Add ${item.name} to order`}
          className="button-secondary mt-5 w-full justify-between"
          disabled={unavailable}
          onClick={onAdd}
          type="button"
        >
          <span>{unavailable ? "Unavailable" : quantity > 0 ? `${quantity} in order` : "Add to order"}</span>
          {!unavailable ? <Icon name="plus" size={17} /> : null}
        </button>
      </div>
    </article>
  );
}

function CustomerHeader({ menu }: { menu: RestaurantMenu }) {
  const monogram = menu.restaurant.name.trim().charAt(0).toUpperCase() || "A";

  return (
    <header className="sticky top-0 z-30 border-b border-ink/10 bg-ivory/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <div
            aria-label={`${menu.restaurant.name} logo`}
            className="restaurant-mark"
            role="img"
            style={menu.restaurant.logoUrl ? { backgroundImage: `url(${menu.restaurant.logoUrl})` } : undefined}
          >
            {!menu.restaurant.logoUrl ? monogram : null}
          </div>
          <div className="min-w-0">
            <p className="truncate font-display text-lg text-ink sm:text-xl">{menu.restaurant.name}</p>
            <p className="truncate text-xs uppercase tracking-[0.15em] text-muted">Digital menu</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 rounded-full border border-ink/10 bg-white/55 px-3 py-2 text-sm font-medium text-muted">
          <Icon name="utensils" size={16} />
          <span className="hidden sm:inline">Table</span> {menu.table.label}
        </div>
      </div>
    </header>
  );
}

function OrderConfirmation({
  confirmation,
  menu,
  onOrderMore,
}: {
  confirmation: OrderConfirmation;
  menu: RestaurantMenu;
  onOrderMore: () => void;
}) {
  const orderReference = confirmation.orderNumber || confirmation.orderId.slice(0, 8).toUpperCase();

  return (
    <main className="mx-auto flex min-h-[calc(100vh-82px)] max-w-2xl items-center justify-center px-4 py-12 sm:px-6">
      <section className="glass-panel relative w-full overflow-hidden px-6 py-12 text-center sm:px-12 sm:py-16">
        <div className="confirmation-glow" />
        <div className="relative">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-sage text-white shadow-soft">
            <Icon name="check" size={30} strokeWidth={2.2} />
          </span>
          <p className="eyebrow mt-7">Order received</p>
          <h1 className="mt-2 font-display text-4xl leading-tight text-ink sm:text-5xl">A delicious choice.</h1>
          <p className="mx-auto mt-5 max-w-md text-sm leading-7 text-muted sm:text-base">
            Your order is on its way to the team at {menu.restaurant.name}. Keep this number nearby if you need to check in.
          </p>
          <div className="mx-auto mt-8 flex max-w-sm items-center justify-between gap-4 rounded-2xl border border-ink/10 bg-white/55 px-5 py-4 text-left">
            <div>
              <p className="text-xs uppercase tracking-[0.15em] text-muted">Order number</p>
              <p className="mt-1 text-lg font-semibold tracking-[0.08em] text-ink">#{orderReference}</p>
            </div>
            {confirmation.estimatedMinutes ? (
              <div className="text-right">
                <p className="text-xs uppercase tracking-[0.15em] text-muted">Ready in</p>
                <p className="mt-1 text-lg font-semibold text-ink">~{confirmation.estimatedMinutes} min</p>
              </div>
            ) : null}
          </div>
          <button className="button-primary mx-auto mt-8" onClick={onOrderMore} type="button">
            Order something else
            <Icon name="arrow-right" size={17} />
          </button>
        </div>
      </section>
    </main>
  );
}

export function CustomerMenu({ restaurantSlug, tableToken }: CustomerMenuProps) {
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [menu, setMenu] = useState<RestaurantMenu | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [specialInstructions, setSpecialInstructions] = useState("");
  const [confirmation, setConfirmation] = useState<OrderConfirmation | null>(null);
  const [activeCategory, setActiveCategory] = useState("all");

  const loadMenu = useCallback(async () => {
    setStatus("loading");
    setLoadError(null);
    try {
      const result = await getRestaurantMenu(restaurantSlug, tableToken);
      setMenu(result);
      setStatus("ready");
    } catch (error) {
      setStatus("error");
      setLoadError(error instanceof Error ? error.message : "The menu could not be loaded.");
    }
  }, [restaurantSlug, tableToken]);

  useEffect(() => {
    void loadMenu();
  }, [loadMenu]);

  const categories = useMemo(() => (menu ? buildCategories(menu) : []), [menu]);

  useEffect(() => {
    if (activeCategory !== "all" && !categories.some((category) => category.id === activeCategory)) {
      setActiveCategory("all");
    }
  }, [activeCategory, categories]);

  const visibleItems = useMemo(() => {
    if (!menu || activeCategory === "all") {
      return menu?.items || [];
    }

    return menu.items.filter((item) => categoryKey(item) === activeCategory);
  }, [activeCategory, menu]);

  const cartItems = useMemo<CartLine[]>(() => {
    if (!menu) {
      return [];
    }

    return Object.entries(cart)
      .map(([id, quantity]) => {
        const item = menu.items.find((candidate) => candidate.id === id);
        return item ? { id: item.id, name: item.name, price: item.price, quantity } : null;
      })
      .filter((item): item is CartLine => item !== null && item.quantity > 0);
  }, [cart, menu]);

  const itemCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);

  function addItem(item: MenuItem) {
    if (item.isAvailable === false) {
      return;
    }
    setCart((current) => ({ ...current, [item.id]: (current[item.id] || 0) + 1 }));
    setSubmitError(null);
  }

  function setQuantity(id: string, quantity: number) {
    setCart((current) => {
      const next = { ...current };
      if (quantity <= 0) {
        delete next[id];
      } else {
        next[id] = quantity;
      }
      return next;
    });
    setSubmitError(null);
  }

  async function placeOrder() {
    if (!menu || cartItems.length === 0) {
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await submitOrder({
        restaurant_slug: restaurantSlug,
        table_token: tableToken,
        items: cartItems.map((item) => ({ menu_item_id: item.id, quantity: item.quantity })),
        special_instructions: specialInstructions.trim(),
      });
      setCart({});
      setSpecialInstructions("");
      setCartOpen(false);
      setConfirmation(result);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Your order could not be sent.");
    } finally {
      setSubmitting(false);
    }
  }

  if (status === "loading") {
    return (
      <>
        <div className="customer-ambient" />
        <LoadingState label="Preparing your menu" />
      </>
    );
  }

  if (status === "error" || !menu) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl items-center px-4 py-12 sm:px-6">
        <div className="w-full">
          <p className="eyebrow mb-3 text-center">Altiora menu</p>
          <ErrorState message={loadError || "The table link may have expired."} onRetry={() => void loadMenu()} />
        </div>
      </main>
    );
  }

  if (confirmation) {
    return (
      <>
        <CustomerHeader menu={menu} />
        <OrderConfirmation confirmation={confirmation} menu={menu} onOrderMore={() => setConfirmation(null)} />
      </>
    );
  }

  const currency = menu.currency || "USD";

  return (
    <>
      <CustomerHeader menu={menu} />
      <main className="relative mx-auto max-w-7xl px-4 pb-28 pt-8 sm:px-6 lg:px-8 lg:pb-12 lg:pt-12">
        <div className="customer-ambient" />
        <section className="relative mb-9 max-w-3xl">
          <p className="eyebrow">A table set for you</p>
          <h1 className="mt-3 font-display text-4xl leading-[1.08] text-ink sm:text-6xl">Take your time. Taste everything.</h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-muted sm:text-lg">
            {menu.restaurant.tagline || "Explore the menu, make it yours, and we will bring it right to your table."}
          </p>
        </section>

        <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <section aria-labelledby="menu-title" className="min-w-0">
            <div className="mb-5 flex items-end justify-between gap-4">
              <div>
                <p className="eyebrow">The menu</p>
                <h2 className="mt-1 font-display text-3xl text-ink" id="menu-title">Made for lingering</h2>
              </div>
              <span className="hidden rounded-full bg-white/60 px-3 py-2 text-xs font-semibold text-muted sm:inline-flex">
                {menu.items.length} {menu.items.length === 1 ? "dish" : "dishes"}
              </span>
            </div>

            {menu.items.length === 0 ? (
              <EmptyState
                message="There is nothing to order from this table just yet. Please ask the team for a hand."
                title="The menu is resting"
                icon="utensils"
              />
            ) : (
              <>
                <nav aria-label="Menu categories" className="hide-scrollbar mb-6 flex gap-2 overflow-x-auto pb-1">
                  <button
                    className={`category-pill ${activeCategory === "all" ? "category-pill-active" : ""}`}
                    onClick={() => setActiveCategory("all")}
                    type="button"
                  >
                    All dishes
                  </button>
                  {categories.map((category) => (
                    <button
                      className={`category-pill ${activeCategory === category.id ? "category-pill-active" : ""}`}
                      key={category.id}
                      onClick={() => setActiveCategory(category.id)}
                      type="button"
                    >
                      {category.name}
                    </button>
                  ))}
                </nav>

                {visibleItems.length === 0 ? (
                  <EmptyState message="Try another section of the menu." title="Nothing here yet" />
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {visibleItems.map((item) => (
                      <MenuItemCard
                        currency={currency}
                        item={item}
                        key={item.id}
                        onAdd={() => addItem(item)}
                        quantity={cart[item.id] || 0}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </section>

          <aside className="hidden lg:sticky lg:top-28 lg:block">
            <OrderCart
              currency={currency}
              headingId="desktop-cart-title"
              itemCount={itemCount}
              items={cartItems}
              onQuantityChange={setQuantity}
              onSubmit={() => void placeOrder()}
              onSpecialInstructionsChange={setSpecialInstructions}
              submitting={submitting}
              specialInstructions={specialInstructions}
              submitError={submitError}
              subtotal={subtotal}
              tableLabel={menu.table.label}
            />
          </aside>
        </div>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-30 px-4 pb-4 lg:hidden">
        <button className="mobile-cart-bar" onClick={() => setCartOpen(true)} type="button">
          <span className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15">
              <Icon name="shopping-bag" size={18} />
            </span>
            <span className="text-left">
              <span className="block text-xs uppercase tracking-[0.14em] text-white/65">Your order</span>
              <span className="mt-0.5 block text-sm font-semibold">{itemCount ? `${itemCount} ${itemCount === 1 ? "item" : "items"}` : "Start an order"}</span>
            </span>
          </span>
          <span className="flex items-center gap-2 text-sm font-semibold">
            {formatPrice(subtotal, currency)}
            <Icon name="arrow-right" size={17} />
          </span>
        </button>
      </div>

      {cartOpen ? (
        <div className="fixed inset-0 z-40 flex items-end bg-ink/25 p-0 backdrop-blur-sm lg:hidden" role="presentation">
          <button aria-label="Close cart" className="absolute inset-0 h-full w-full cursor-default" onClick={() => setCartOpen(false)} type="button" />
          <div className="relative max-h-[90vh] w-full animate-slide-up overflow-y-auto rounded-t-[2rem] bg-ivory p-4 shadow-glass sm:p-6" role="dialog" aria-modal="true" aria-labelledby="mobile-cart-title">
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-ink/15" />
            <OrderCart
              currency={currency}
              headingId="mobile-cart-title"
              itemCount={itemCount}
              items={cartItems}
              onQuantityChange={setQuantity}
              onSubmit={() => void placeOrder()}
              onSpecialInstructionsChange={setSpecialInstructions}
              submitting={submitting}
              specialInstructions={specialInstructions}
              submitError={submitError}
              subtotal={subtotal}
              tableLabel={menu.table.label}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
