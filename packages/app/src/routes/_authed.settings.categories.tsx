import type { CategoryData } from "@/hooks/useCategories";

import { createFileRoute } from "@tanstack/react-router";
import { EllipsisIcon, ShapesIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { CategoryKind } from "@archant/data/schema/categories";
import { CATEGORY_KINDS } from "@archant/data/schema/categories";

import { CategoryDialog } from "@/components/CategoryDialog";
import { DeleteCategoryDialog } from "@/components/DeleteCategoryDialog";
import { EmptyState } from "@/components/EmptyState";
import { InsetGroup } from "@/components/InsetGroup";
import { ListCard } from "@/components/ListCard";
import { MergeCategoryDialog } from "@/components/MergeCategoryDialog";
import { Page } from "@/components/Page";
import { TintedIcon } from "@/components/TintedIcon";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useCategories } from "@/hooks/useCategories";
import { errorCodeOf } from "@/lib/api";
import { categoryTree } from "@/lib/category-tree";

export const Route = createFileRoute("/_authed/settings/categories")({
	component: CategoriesPage,
});

type Action = "edit" | "merge" | "delete";

/**
 * The dialog open, kept while it closes so its content does not vanish
 * mid-animation. An id, not the category: the dialog reads it from the
 * current list, so a count or a name that changed since opening is fresh.
 */
type Opened = { action: "create"; kind?: CategoryKind } | { action: Action; id: string };

function CategoryRow({
	category,
	onAction,
}: {
	category: CategoryData;
	onAction: (action: Action) => void;
}) {
	const { t } = useTranslation();

	return (
		<div className="flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-hover">
			<TintedIcon subject={{ kind: "category", color: category.color, icon: category.icon }} />
			<span className="min-w-0 flex-1 truncate font-medium">{category.name}</span>
			<span className="shrink-0 text-muted-foreground tabular-nums">
				{t("categories.transactions", { count: category.transactionCount })}
			</span>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						aria-label={t("categories.actions", { name: category.name })}
					>
						<EllipsisIcon />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem onSelect={() => onAction("edit")}>
						{t("categories.edit")}
					</DropdownMenuItem>
					<DropdownMenuItem onSelect={() => onAction("merge")}>
						{t("categories.merge")}
					</DropdownMenuItem>
					<DropdownMenuItem variant="destructive" onSelect={() => onAction("delete")}>
						{t("categories.delete")}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

function CategoryGroup({
	kind,
	categories,
	onAction,
	onAdd,
}: {
	kind: CategoryKind;
	categories: readonly CategoryData[];
	onAction: (action: Action, category: CategoryData) => void;
	/** Opens the form on this group's type. */
	onAdd: () => void;
}) {
	const { t } = useTranslation();
	const headingId = `categories-${kind}`;
	const branches = categoryTree(categories).filter(({ parent }) => parent.kind === kind);

	const count = categories.filter((category) => category.kind === kind).length;

	return (
		<InsetGroup id={headingId} level={2} title={t(`categories.groups.${kind}`)} count={count}>
			{branches.length === 0 ? (
				// The group's block is the card already.
				<EmptyState
					flush
					icon={{ kind: "transfer", icon: ShapesIcon }}
					title={t(`categories.groupEmpty.${kind}`)}
					description={t("categories.groupEmpty.description")}
					action={<Button onClick={onAdd}>{t("categories.add")}</Button>}
				/>
			) : (
				<ul className="divide-y divide-line">
					{branches.map(({ parent, children }) => {
						return (
							<li key={parent.id}>
								<CategoryRow category={parent} onAction={(action) => onAction(action, parent)} />
								{children.length > 0 && (
									<ul className="divide-y divide-line border-t border-line pl-6">
										{children.map((child) => (
											<li key={child.id}>
												<CategoryRow
													category={child}
													onAction={(action) => onAction(action, child)}
												/>
											</li>
										))}
									</ul>
								)}
							</li>
						);
					})}
				</ul>
			)}
		</InsetGroup>
	);
}

function CategoriesPage() {
	const { t } = useTranslation();
	const categories = useCategories();
	const [opened, setOpened] = useState<Opened | null>(null);
	const [open, setOpen] = useState(false);
	const list = categories.data ?? [];
	const category =
		opened === null || opened.action === "create"
			? undefined
			: list.find((candidate) => candidate.id === opened.id);
	// Deleted or merged elsewhere since it opened: nothing left to act on.
	const gone = opened !== null && opened.action !== "create" && category === undefined;

	useEffect(() => {
		if (gone) {
			setOpen(false);
			setOpened(null);
		}
	}, [gone]);

	useEffect(() => {
		document.title = t("app.pageTitle", { page: t("categories.title"), app: t("app.name") });
	}, [t]);

	const show = (next: Opened) => {
		setOpened(next);
		setOpen(true);
	};

	return (
		<Page
			centred
			title={t("categories.title")}
			description={t("categories.description")}
			actions={<Button onClick={() => show({ action: "create" })}>{t("categories.add")}</Button>}
			className="gap-4"
		>
			{categories.isPending && (
				<div className="flex flex-col gap-2">
					<Skeleton className="h-5 w-24" />
					<Skeleton className="h-14 w-full" />
					<Skeleton className="h-14 w-full" />
				</div>
			)}

			{categories.isError && (
				<div role="alert" className="flex flex-col items-start gap-3 rounded-lg border bg-card p-4">
					<p className="text-muted-foreground">{t(`errors.${errorCodeOf(categories.error)}`)}</p>
					<Button variant="outline" onClick={() => void categories.refetch()}>
						{t("common.retry")}
					</Button>
				</div>
			)}

			{categories.data !== undefined && (
				<ListCard>
					{CATEGORY_KINDS.map((kind) => (
						<CategoryGroup
							key={kind}
							kind={kind}
							categories={list}
							onAction={(action, target) => show({ action, id: target.id })}
							onAdd={() => show({ action: "create", kind })}
						/>
					))}
				</ListCard>
			)}

			{(opened?.action === "create" || (opened?.action === "edit" && category !== undefined)) && (
				<CategoryDialog
					open={open}
					onOpenChange={setOpen}
					category={category}
					categories={list}
					kind={opened.action === "create" ? opened.kind : undefined}
				/>
			)}
			{opened?.action === "delete" && category !== undefined && (
				<DeleteCategoryDialog
					open={open}
					onOpenChange={setOpen}
					category={category}
					categories={list}
				/>
			)}
			{opened?.action === "merge" && category !== undefined && (
				<MergeCategoryDialog
					open={open}
					onOpenChange={setOpen}
					category={category}
					categories={list}
				/>
			)}
		</Page>
	);
}
