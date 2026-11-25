import { useId, useRef, useState, type FormEvent } from 'react';
import { isApiClientError } from '../../api/errors.ts';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import { formatInrDisplay, normalizeInrPriceInput } from '../../utils/inrPrice.ts';
import type { CatalogApi } from '../catalogApi.ts';
import type {
  Category,
  CategoryOption,
  CreateSkuResponse,
  ProductResponse,
} from '../types.ts';

export type ProductAndSkuModalMode =
  | { kind: 'create-product'; defaultCategoryId?: string }
  | { kind: 'add-sku'; productId: string; productName: string };

export interface ProductAndSkuModalProps {
  open: boolean;
  mode: ProductAndSkuModalMode | null;
  api: CatalogApi;
  categoryOptions: readonly CategoryOption[];
  onClose: () => void;
  onCategoryCreated: (category: Category) => Promise<void> | void;
  onProductCreated: (product: ProductResponse) => void;
  onSkuCreated: (productId: string, sku: CreateSkuResponse) => Promise<void> | void;
}

interface ProductFieldErrors {
  categoryId?: string;
  name?: string;
  brand?: string;
  design?: string;
}

interface SkuFieldErrors {
  skuCode?: string;
  size?: string;
  defaultSellingPrice?: string;
}

interface ProductAndSkuFormProps {
  mode: ProductAndSkuModalMode;
  api: CatalogApi;
  categoryOptions: readonly CategoryOption[];
  onClose: () => void;
  onCategoryCreated: (category: Category) => Promise<void> | void;
  onProductCreated: (product: ProductResponse) => void;
  onSkuCreated: (productId: string, sku: CreateSkuResponse) => Promise<void> | void;
  onStepOrProductChange: (title: string) => void;
  onBusyChange: (busy: boolean) => void;
}

function ProductAndSkuForm({
  mode,
  api,
  categoryOptions,
  onClose,
  onCategoryCreated,
  onProductCreated,
  onSkuCreated,
  onStepOrProductChange,
  onBusyChange,
}: ProductAndSkuFormProps) {
  const categorySelectId = useId();
  const categoryErrorId = useId();
  const productNameId = useId();
  const productNameErrorId = useId();
  const brandId = useId();
  const designId = useId();

  const quickCatNameId = useId();
  const quickCatParentId = useId();

  const skuCodeId = useId();
  const skuCodeErrorId = useId();
  const sizeId = useId();
  const sizeHintId = useId();
  const sizeErrorId = useId();
  const priceId = useId();
  const priceHintId = useId();
  const priceErrorId = useId();

  const [step, setStep] = useState<'product' | 'sku'>(
    mode.kind === 'add-sku' ? 'sku' : 'product',
  );
  const [activeProduct, setActiveProduct] = useState<{
    productId: string;
    name: string;
  } | null>(
    mode.kind === 'add-sku'
      ? { productId: mode.productId, name: mode.productName }
      : null,
  );

  // Step 1: Product state
  const [categoryId, setCategoryId] = useState(
    mode.kind === 'create-product' ? (mode.defaultCategoryId ?? '') : '',
  );
  const [productName, setProductName] = useState('');
  const [brand, setBrand] = useState('');
  const [design, setDesign] = useState('');
  const [productErrors, setProductErrors] = useState<ProductFieldErrors>({});
  const [productSubmitError, setProductSubmitError] = useState<{
    message: string;
    requestId?: string | null;
  } | null>(null);
  const [isSavingProduct, setIsSavingProduct] = useState(false);

  // Optional inline Category sub-form inside Step 1
  const [showInlineCategory, setShowInlineCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryParentId, setNewCategoryParentId] = useState('');
  const [inlineCategoryError, setInlineCategoryError] = useState<string | null>(null);
  const [isSavingCategory, setIsSavingCategory] = useState(false);

  // Step 2: SKU state
  const [skuCode, setSkuCode] = useState('');
  const [size, setSize] = useState('');
  const [priceInput, setPriceInput] = useState('');
  const [skuErrors, setSkuErrors] = useState<SkuFieldErrors>({});
  const [skuSubmitError, setSkuSubmitError] = useState<{
    message: string;
    requestId?: string | null;
  } | null>(null);
  const [skuSuccessMessage, setSkuSuccessMessage] = useState<string | null>(null);
  const [addedSkus, setAddedSkus] = useState<CreateSkuResponse[]>([]);
  const [isSavingSku, setIsSavingSku] = useState(false);

  const productSubmittingRef = useRef(false);
  const skuSubmittingRef = useRef(false);
  const categorySelectRef = useRef<HTMLSelectElement | null>(null);
  const productNameInputRef = useRef<HTMLInputElement | null>(null);
  const skuCodeInputRef = useRef<HTMLInputElement | null>(null);
  const sizeInputRef = useRef<HTMLInputElement | null>(null);
  const priceInputRef = useRef<HTMLInputElement | null>(null);

  const handleCreateInlineCategory = async () => {
    if (isSavingCategory) {
      return;
    }
    const trimmed = newCategoryName.trim();
    if (!trimmed) {
      setInlineCategoryError('Enter a category name.');
      return;
    }
    if (trimmed.length > 150) {
      setInlineCategoryError('Category name must not exceed 150 characters.');
      return;
    }

    setIsSavingCategory(true);
    onBusyChange(true);
    setInlineCategoryError(null);
    try {
      const created = await api.createCategory({
        name: trimmed,
        parentId: newCategoryParentId || null,
      });
      await onCategoryCreated(created);
      setCategoryId(created.categoryId);
      setProductErrors((prev) => ({ ...prev, categoryId: undefined }));
      setNewCategoryName('');
      setNewCategoryParentId('');
      setShowInlineCategory(false);
    } catch (error) {
      if (isApiClientError(error)) {
        setInlineCategoryError(error.message);
      } else {
        setInlineCategoryError('Could not create category.');
      }
    } finally {
      setIsSavingCategory(false);
      onBusyChange(false);
    }
  };

  const handleProductSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (productSubmittingRef.current || isSavingProduct) {
      return;
    }

    const errors: ProductFieldErrors = {};
    const trimmedName = productName.trim();
    if (!categoryId) {
      errors.categoryId = 'Select a category.';
    }
    if (!trimmedName) {
      errors.name = 'Enter a product name.';
    } else if (trimmedName.length > 200) {
      errors.name = 'Product name must not exceed 200 characters.';
    }

    if (errors.categoryId || errors.name) {
      setProductErrors(errors);
      setProductSubmitError({ message: 'Please complete the required product fields.' });
      if (errors.categoryId) {
        categorySelectRef.current?.focus();
      } else {
        productNameInputRef.current?.focus();
      }
      return;
    }

    productSubmittingRef.current = true;
    setIsSavingProduct(true);
    onBusyChange(true);
    setProductErrors({});
    setProductSubmitError(null);

    try {
      const created = await api.createProduct({
        categoryId,
        name: trimmedName,
        brand: brand.trim() || null,
        design: design.trim() || null,
      });
      onProductCreated(created);
      setActiveProduct({ productId: created.productId, name: created.name });
      setStep('sku');
      onStepOrProductChange(`Add SKU — Step 2 of 2 (${created.name})`);
    } catch (error) {
      if (isApiClientError(error)) {
        const nextErrors: ProductFieldErrors = {};
        for (const item of error.fieldErrors) {
          if (item.field === 'categoryId') nextErrors.categoryId = item.message;
          if (item.field === 'name') nextErrors.name = item.message;
          if (item.field === 'brand') nextErrors.brand = item.message;
          if (item.field === 'design') nextErrors.design = item.message;
        }
        setProductErrors(nextErrors);
        setProductSubmitError({
          message: error.message || 'Could not create product.',
          requestId: error.requestId,
        });
      } else {
        setProductSubmitError({ message: 'Could not create product. Please try again.' });
      }
    } finally {
      productSubmittingRef.current = false;
      setIsSavingProduct(false);
      onBusyChange(false);
    }
  };

  const handleSkuSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeProduct || skuSubmittingRef.current || isSavingSku) {
      return;
    }

    const errors: SkuFieldErrors = {};
    const trimmedCode = skuCode.trim();
    const trimmedSize = size.trim();
    const priceResult = normalizeInrPriceInput(priceInput);

    if (!trimmedCode) {
      errors.skuCode = 'Enter a SKU code.';
    } else if (trimmedCode.length > 100) {
      errors.skuCode = 'SKU code must not exceed 100 characters.';
    }
    if (trimmedSize.length > 50) {
      errors.size = 'Size must not exceed 50 characters.';
    }
    if (!priceResult.ok) {
      errors.defaultSellingPrice = priceResult.error;
    }

    if (errors.skuCode || errors.size || errors.defaultSellingPrice || !priceResult.ok) {
      setSkuErrors(errors);
      setSkuSubmitError({ message: 'Fix the highlighted SKU fields before saving.' });
      setSkuSuccessMessage(null);
      if (errors.skuCode) {
        skuCodeInputRef.current?.focus();
      } else if (errors.size) {
        sizeInputRef.current?.focus();
      } else {
        priceInputRef.current?.focus();
      }
      return;
    }

    skuSubmittingRef.current = true;
    setIsSavingSku(true);
    onBusyChange(true);
    setSkuErrors({});
    setSkuSubmitError(null);
    setSkuSuccessMessage(null);

    try {
      const created = await api.createSku(activeProduct.productId, {
        skuCode: trimmedCode,
        size: trimmedSize || null,
        defaultSellingPrice: priceResult.value,
      });

      await onSkuCreated(activeProduct.productId, created);
      setAddedSkus((prev) => [...prev, created]);
      setSkuSuccessMessage(
        `Saved SKU ${created.skuCode}${created.size ? ` (size ${created.size})` : ' (unsized)'} at ${formatInrDisplay(created.defaultSellingPrice)}.`,
      );
      setSkuCode('');
      setSize('');
      setPriceInput('');
      setSkuErrors({});
      skuCodeInputRef.current?.focus();
    } catch (error) {
      if (isApiClientError(error)) {
        const nextErrors: SkuFieldErrors = {};
        for (const item of error.fieldErrors) {
          if (item.field === 'skuCode') nextErrors.skuCode = item.message;
          if (item.field === 'size') nextErrors.size = item.message;
          if (item.field === 'defaultSellingPrice') nextErrors.defaultSellingPrice = item.message;
        }

        if (error.code === 'DUPLICATE_SKU') {
          const hasExplicitFields = Boolean(nextErrors.skuCode || nextErrors.size);
          const duplicateMessage = trimmedSize
            ? 'This SKU code or size variant already exists for this product. Enter a unique SKU code and size.'
            : 'An unsized SKU already exists for this product, or this SKU code is already in use. Enter a unique SKU code or specify a size.';
          setSkuErrors(
            hasExplicitFields
              ? nextErrors
              : {
                  skuCode: 'Verify this SKU code is not already used.',
                  size: trimmedSize
                    ? 'Verify this size is not already added for this product.'
                    : 'Only one unsized SKU is allowed per product.',
                },
          );
          setSkuSubmitError({
            message: duplicateMessage,
            requestId: error.requestId,
          });
        } else {
          setSkuErrors(nextErrors);
          setSkuSubmitError({
            message: error.message || 'Could not save SKU.',
            requestId: error.requestId,
          });
        }
      } else {
        setSkuSubmitError({ message: 'Could not save SKU. Please retry.' });
      }
    } finally {
      skuSubmittingRef.current = false;
      setIsSavingSku(false);
      onBusyChange(false);
    }
  };

  const sizeDescribedBy = skuErrors.size ? `${sizeHintId} ${sizeErrorId}` : sizeHintId;
  const priceDescribedBy = skuErrors.defaultSellingPrice
    ? `${priceHintId} ${priceErrorId}`
    : priceHintId;

  if (step === 'product') {
    return (
      <>
        {productSubmitError ? (
          <div className="alert-banner alert-banner--error" role="alert">
            <div className="alert-banner__content">
              <p>{productSubmitError.message}</p>
              {productSubmitError.requestId ? (
                <p className="alert-banner__meta">Request ID: {productSubmitError.requestId}</p>
              ) : null}
            </div>
          </div>
        ) : null}

        <form className="catalog-modal-form" onSubmit={handleProductSubmit} noValidate>
          <div className="catalog-field">
            <div className="catalog-label-row">
              <label htmlFor={categorySelectId} className="catalog-label">
                Category <span className="form-required" aria-hidden="true">*</span>
              </label>
              <button
                type="button"
                className="catalog-inline-link"
                aria-expanded={showInlineCategory}
                onClick={() => {
                  setShowInlineCategory((prev) => !prev);
                  setInlineCategoryError(null);
                }}
              >
                {showInlineCategory ? 'Hide new category' : '+ New category'}
              </button>
            </div>
            <select
              ref={categorySelectRef}
              id={categorySelectId}
              name="categoryId"
              className="catalog-select"
              value={categoryId}
              onChange={(event) => {
                setCategoryId(event.target.value);
                if (productErrors.categoryId && event.target.value) {
                  setProductErrors((prev) => ({ ...prev, categoryId: undefined }));
                }
              }}
              required
              autoFocus
              aria-invalid={productErrors.categoryId ? 'true' : 'false'}
              aria-describedby={productErrors.categoryId ? categoryErrorId : undefined}
            >
              <option value="">Select a category…</option>
              {categoryOptions.map((cat) => (
                <option key={cat.categoryId} value={cat.categoryId}>
                  {cat.label}
                </option>
              ))}
            </select>
            {productErrors.categoryId ? (
              <p id={categoryErrorId} className="catalog-field-error">
                <span aria-hidden="true">!</span>
                <span>{productErrors.categoryId}</span>
              </p>
            ) : null}
          </div>

          {showInlineCategory ? (
            <fieldset className="catalog-inline-fieldset">
              <legend>Quick-create category</legend>
              {inlineCategoryError ? (
                <p className="catalog-field-error" role="alert">
                  <span aria-hidden="true">!</span>
                  <span>{inlineCategoryError}</span>
                </p>
              ) : null}
              <div className="catalog-field">
                <label htmlFor={quickCatNameId} className="catalog-label">
                  New category name <span className="form-required" aria-hidden="true">*</span>
                </label>
                <input
                  id={quickCatNameId}
                  type="text"
                  className="catalog-input"
                  value={newCategoryName}
                  onChange={(event) => setNewCategoryName(event.target.value)}
                  maxLength={150}
                />
              </div>
              <div className="catalog-field">
                <label htmlFor={quickCatParentId} className="catalog-label">
                  Parent category (optional)
                </label>
                <select
                  id={quickCatParentId}
                  className="catalog-select"
                  value={newCategoryParentId}
                  onChange={(event) => setNewCategoryParentId(event.target.value)}
                >
                  <option value="">None (top-level category)</option>
                  {categoryOptions.map((cat) => (
                    <option key={cat.categoryId} value={cat.categoryId}>
                      {cat.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="catalog-inline-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={isSavingCategory}
                  onClick={() => {
                    void handleCreateInlineCategory();
                  }}
                >
                  {isSavingCategory ? 'Adding category…' : 'Save & select category'}
                </button>
              </div>
            </fieldset>
          ) : null}

          <div className="catalog-field">
            <label htmlFor={productNameId} className="catalog-label">
              Product name <span className="form-required" aria-hidden="true">*</span>
            </label>
            <input
              ref={productNameInputRef}
              id={productNameId}
              name="productName"
              type="text"
              className="catalog-input"
              value={productName}
              onChange={(event) => {
                setProductName(event.target.value);
                if (productErrors.name && event.target.value.trim()) {
                  setProductErrors((prev) => ({ ...prev, name: undefined }));
                }
              }}
              maxLength={200}
              required
              aria-invalid={productErrors.name ? 'true' : 'false'}
              aria-describedby={productErrors.name ? productNameErrorId : undefined}
            />
            {productErrors.name ? (
              <p id={productNameErrorId} className="catalog-field-error">
                <span aria-hidden="true">!</span>
                <span>{productErrors.name}</span>
              </p>
            ) : null}
          </div>

          <div className="catalog-field">
            <label htmlFor={brandId} className="catalog-label">
              Brand (optional)
            </label>
            <input
              id={brandId}
              name="brand"
              type="text"
              className="catalog-input"
              value={brand}
              onChange={(event) => setBrand(event.target.value)}
              maxLength={150}
            />
          </div>

          <div className="catalog-field">
            <label htmlFor={designId} className="catalog-label">
              Design (optional)
            </label>
            <input
              id={designId}
              name="design"
              type="text"
              className="catalog-input"
              value={design}
              onChange={(event) => setDesign(event.target.value)}
              maxLength={150}
            />
          </div>

          <div className="catalog-modal-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              disabled={isSavingProduct || isSavingCategory}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={isSavingProduct || isSavingCategory}
              aria-busy={isSavingProduct}
            >
              {isSavingProduct ? 'Saving product…' : 'Save product & add SKU'}
            </button>
          </div>
        </form>
      </>
    );
  }

  return (
    <>
      <div className="alert-banner alert-banner--info" role="status">
        <div className="alert-banner__content">
          <p>
            Adding SKU variant for <strong>{activeProduct?.name}</strong>
          </p>
        </div>
      </div>

      {skuSuccessMessage ? (
        <div className="alert-banner alert-banner--info" role="status">
          <div className="alert-banner__content">
            <p>{skuSuccessMessage}</p>
          </div>
        </div>
      ) : null}

      {addedSkus.length > 0 ? (
        <div className="catalog-added-list" aria-label="Added variants in this session">
          <p className="catalog-added-list__title">Saved in this session:</p>
          <ul>
            {addedSkus.map((item) => (
              <li key={item.skuId}>
                <code>{item.skuCode}</code> — {item.size ? `Size ${item.size}` : 'Unsized'} —{' '}
                {formatInrDisplay(item.defaultSellingPrice)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {skuSubmitError ? (
        <div className="alert-banner alert-banner--error" role="alert">
          <div className="alert-banner__content">
            <p>{skuSubmitError.message}</p>
            {skuSubmitError.requestId ? (
              <p className="alert-banner__meta">Request ID: {skuSubmitError.requestId}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      <form className="catalog-modal-form" onSubmit={handleSkuSubmit} noValidate>
        <div className="catalog-field">
          <label htmlFor={skuCodeId} className="catalog-label">
            SKU code <span className="form-required" aria-hidden="true">*</span>
          </label>
          <input
            ref={skuCodeInputRef}
            id={skuCodeId}
            name="skuCode"
            type="text"
            className="catalog-input"
            value={skuCode}
            onChange={(event) => {
              setSkuCode(event.target.value);
              if (skuErrors.skuCode && event.target.value.trim()) {
                setSkuErrors((prev) => ({ ...prev, skuCode: undefined }));
              }
            }}
            maxLength={100}
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            required
            autoFocus
            aria-invalid={skuErrors.skuCode ? 'true' : 'false'}
            aria-describedby={skuErrors.skuCode ? skuCodeErrorId : undefined}
          />
          {skuErrors.skuCode ? (
            <p id={skuCodeErrorId} className="catalog-field-error">
              <span aria-hidden="true">!</span>
              <span>{skuErrors.skuCode}</span>
            </p>
          ) : null}
        </div>

        <div className="catalog-field">
          <label htmlFor={sizeId} className="catalog-label">
            Size (optional)
          </label>
          <span id={sizeHintId} className="catalog-field-hint">
            Leave blank for unsized items such as sarees. Enter a size (e.g. 32, 34, M) for sized
            variants.
          </span>
          <input
            ref={sizeInputRef}
            id={sizeId}
            name="size"
            type="text"
            className="catalog-input"
            value={size}
            onChange={(event) => {
              setSize(event.target.value);
              if (skuErrors.size) {
                setSkuErrors((prev) => ({ ...prev, size: undefined }));
              }
            }}
            maxLength={50}
            aria-invalid={skuErrors.size ? 'true' : 'false'}
            aria-describedby={sizeDescribedBy}
          />
          {skuErrors.size ? (
            <p id={sizeErrorId} className="catalog-field-error">
              <span aria-hidden="true">!</span>
              <span>{skuErrors.size}</span>
            </p>
          ) : null}
        </div>

        <div className="catalog-field">
          <label htmlFor={priceId} className="catalog-label">
            Default selling price (INR) <span className="form-required" aria-hidden="true">*</span>
          </label>
          <span id={priceHintId} className="catalog-field-hint">
            Enter rupees with up to 2 decimal places (for example, 4500 or 199.50).
          </span>
          <input
            ref={priceInputRef}
            id={priceId}
            name="defaultSellingPrice"
            type="text"
            inputMode="decimal"
            className="catalog-input"
            value={priceInput}
            onChange={(event) => {
              setPriceInput(event.target.value);
              if (skuErrors.defaultSellingPrice) {
                const check = normalizeInrPriceInput(event.target.value);
                if (check.ok) {
                  setSkuErrors((prev) => ({ ...prev, defaultSellingPrice: undefined }));
                }
              }
            }}
            required
            aria-invalid={skuErrors.defaultSellingPrice ? 'true' : 'false'}
            aria-describedby={priceDescribedBy}
          />
          {skuErrors.defaultSellingPrice ? (
            <p id={priceErrorId} className="catalog-field-error">
              <span aria-hidden="true">!</span>
              <span>{skuErrors.defaultSellingPrice}</span>
            </p>
          ) : null}
        </div>

        <div className="catalog-modal-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={isSavingSku}
          >
            {addedSkus.length > 0 ? 'Done' : 'Cancel'}
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={isSavingSku}
            aria-busy={isSavingSku}
          >
            {isSavingSku
              ? 'Saving SKU…'
              : addedSkus.length > 0
                ? 'Save another SKU'
                : 'Save SKU'}
          </button>
        </div>
      </form>
    </>
  );
}

export function ProductAndSkuModal({
  open,
  mode,
  api,
  categoryOptions,
  onClose,
  onCategoryCreated,
  onProductCreated,
  onSkuCreated,
}: ProductAndSkuModalProps) {
  const [customTitle, setCustomTitle] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const initialTitle =
    mode?.kind === 'add-sku'
      ? `Add size variant — ${mode.productName}`
      : 'New product — Step 1 of 2';

  const handleClose = () => {
    if (isBusy) {
      return;
    }
    setCustomTitle(null);
    onClose();
  };

  const formKey =
    mode?.kind === 'add-sku'
      ? `add-${mode.productId}`
      : `create-${mode?.defaultCategoryId ?? ''}`;

  return (
    <ModalDialog
      open={open && Boolean(mode)}
      title={customTitle ?? initialTitle}
      onClose={handleClose}
      preventClose={isBusy}
    >
      {open && mode ? (
        <ProductAndSkuForm
          key={formKey}
          mode={mode}
          api={api}
          categoryOptions={categoryOptions}
          onClose={handleClose}
          onCategoryCreated={onCategoryCreated}
          onProductCreated={onProductCreated}
          onSkuCreated={onSkuCreated}
          onStepOrProductChange={setCustomTitle}
          onBusyChange={setIsBusy}
        />
      ) : null}
    </ModalDialog>
  );
}
