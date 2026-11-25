import { useId, useRef, useState, type FormEvent } from 'react';
import { isApiClientError } from '../../api/errors.ts';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import type { CatalogApi } from '../catalogApi.ts';
import type { Category, CategoryOption } from '../types.ts';

export interface CategoryFormModalProps {
  open: boolean;
  api: CatalogApi;
  categoryOptions: readonly CategoryOption[];
  onClose: () => void;
  onCreated: (category: Category) => Promise<void> | void;
}

interface CategoryFieldErrors {
  name?: string;
  parentId?: string;
}

export function CategoryFormModal({
  open,
  api,
  categoryOptions,
  onClose,
  onCreated,
}: CategoryFormModalProps) {
  const nameId = useId();
  const nameErrorId = useId();
  const parentId = useId();
  const parentErrorId = useId();

  const [name, setName] = useState('');
  const [selectedParentId, setSelectedParentId] = useState('');
  const [fieldErrors, setFieldErrors] = useState<CategoryFieldErrors>({});
  const [submitError, setSubmitError] = useState<{ message: string; requestId?: string | null } | null>(
    null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submittingRef = useRef(false);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  const handleResetAndClose = () => {
    if (isSubmitting) {
      return;
    }
    setName('');
    setSelectedParentId('');
    setFieldErrors({});
    setSubmitError(null);
    onClose();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current || isSubmitting) {
      return;
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
      setFieldErrors({ name: 'Enter a category name.' });
      setSubmitError({ message: 'Category name is required.' });
      nameInputRef.current?.focus();
      return;
    }
    if (trimmedName.length > 150) {
      setFieldErrors({ name: 'Category name must not exceed 150 characters.' });
      setSubmitError({ message: 'Category name must not exceed 150 characters.' });
      nameInputRef.current?.focus();
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    setFieldErrors({});
    setSubmitError(null);

    try {
      const created = await api.createCategory({
        name: trimmedName,
        parentId: selectedParentId || null,
      });
      await onCreated(created);
      setName('');
      setSelectedParentId('');
      setFieldErrors({});
      setSubmitError(null);
      onClose();
    } catch (error) {
      if (isApiClientError(error)) {
        const nextFields: CategoryFieldErrors = {};
        for (const item of error.fieldErrors) {
          if (item.field === 'name' && !nextFields.name) {
            nextFields.name = item.message;
          } else if (item.field === 'parentId' && !nextFields.parentId) {
            nextFields.parentId = item.message;
          }
        }
        setFieldErrors(nextFields);
        setSubmitError({
          message: error.message || 'Could not create category.',
          requestId: error.requestId,
        });
      } else {
        setSubmitError({ message: 'Could not create category. Please try again.' });
      }
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <ModalDialog
      open={open}
      title="New category"
      onClose={handleResetAndClose}
      preventClose={isSubmitting}
    >
      {submitError ? (
        <div className="alert-banner alert-banner--error" role="alert">
          <div className="alert-banner__content">
            <p>{submitError.message}</p>
            {submitError.requestId ? (
              <p className="alert-banner__meta">Request ID: {submitError.requestId}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      <form className="catalog-modal-form" onSubmit={handleSubmit} noValidate>
        <div className="catalog-field">
          <label htmlFor={nameId} className="catalog-label">
            Category name <span className="form-required" aria-hidden="true">*</span>
          </label>
          <input
            ref={nameInputRef}
            id={nameId}
            name="categoryName"
            type="text"
            className="catalog-input"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (fieldErrors.name && event.target.value.trim()) {
                setFieldErrors((prev) => ({ ...prev, name: undefined }));
              }
            }}
            maxLength={150}
            required
            autoFocus
            aria-invalid={fieldErrors.name ? 'true' : 'false'}
            aria-describedby={fieldErrors.name ? nameErrorId : undefined}
          />
          {fieldErrors.name ? (
            <p id={nameErrorId} className="catalog-field-error">
              <span aria-hidden="true">!</span>
              <span>{fieldErrors.name}</span>
            </p>
          ) : null}
        </div>

        <div className="catalog-field">
          <label htmlFor={parentId} className="catalog-label">
            Parent category (optional)
          </label>
          <select
            id={parentId}
            name="parentCategoryId"
            className="catalog-select"
            value={selectedParentId}
            onChange={(event) => {
              setSelectedParentId(event.target.value);
              if (fieldErrors.parentId) {
                setFieldErrors((prev) => ({ ...prev, parentId: undefined }));
              }
            }}
            aria-invalid={fieldErrors.parentId ? 'true' : 'false'}
            aria-describedby={fieldErrors.parentId ? parentErrorId : undefined}
          >
            <option value="">None (top-level category)</option>
            {categoryOptions.map((cat) => (
              <option key={cat.categoryId} value={cat.categoryId}>
                {cat.label}
              </option>
            ))}
          </select>
          {fieldErrors.parentId ? (
            <p id={parentErrorId} className="catalog-field-error">
              <span aria-hidden="true">!</span>
              <span>{fieldErrors.parentId}</span>
            </p>
          ) : null}
        </div>

        <div className="catalog-modal-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={handleResetAndClose}
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? 'Saving…' : 'Create category'}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}
