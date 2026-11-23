import { redirect, Form, useActionData, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";
import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export const action = async ({ request }) => {
  const errors = loginErrorMessage(await login(request));

  return { errors };
};

const FEATURES = [
  [
    "Crawlable by AI",
    "Checks robots.txt so ChatGPT, Perplexity, Claude and Google can read your store.",
  ],
  [
    "Summarized for AI",
    "Publishes an llms.txt that lists your collections, top products and policies.",
  ],
  [
    "Correct product info",
    "Adds product schema with live prices, stock, shipping and returns.",
  ],
];

export default function App() {
  const { showForm } = useLoaderData();
  const actionData = useActionData();
  const errors = actionData?.errors;

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Get your Shopify store cited by AI</h1>
        <p className={styles.text}>
          GEO makes sure AI assistants can read your store and get your product
          details right.
        </p>
        {showForm && (
          <Form className={styles.form} method="post">
            <label className={styles.label}>
              <span>Connect your store</span>
              <input
                className={styles.input}
                type="text"
                name="shop"
                placeholder="my-shop-domain.myshopify.com"
                autoComplete="off"
              />
              <span>{errors?.shop ?? "Your store's myshopify.com domain"}</span>
            </label>
            <button className={styles.button} type="submit">
              Connect store
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          {FEATURES.map(([title, description]) => (
            <li key={title}>
              <strong>{title}</strong>. {description}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
