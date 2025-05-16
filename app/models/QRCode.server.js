import qrcode from "qrcode";
import invariant from "tiny-invariant";
import db from "../db.server";

// Tìm một mã QR duy nhất theo id từ db.
// Nếu tìm thấy, gọi supplementQRCode() để bổ sung thêm thông tin như ảnh sản phẩm, đường dẫn
export async function getQRCode(id, graphql) {
  const qrCode = await db.qRCode.findFirst({ where: { id } });

  if (!qrCode) {
    return null;
  }

  return supplementQRCode(qrCode, graphql);
}

// Truy xuất tất cả mã QR thuộc shop cụ thể, nếu không có mã QR nào -> trả về mảng rỗng
// Nếu có, dùng Promise.all để bổ sung thông tin cho từng mã QR.
export async function getQRCodes(shop, graphql) {
  const qrCodes = await db.qRCode.findMany({
    where: { shop },
    orderBy: { id: "desc" },
  });

  if (qrCodes.length === 0) return [];

  return Promise.all(
    qrCodes.map((qrCode) => supplementQRCode(qrCode, graphql)),
  );
}

// Dùng thư viện qrcode để tạo hình ảnh QR dạng Data URL từ URL đó
export function getQRCodeImage(id) {
  const url = new URL(`/qrcodes/${id}/scan`, process.env.SHOPIFY_APP_URL);
  return qrcode.toDataURL(url.href);
}

// Tạo URL đích mà mã QR sẽ trỏ tới:
// Nếu destination là "product" thì dẫn đến trang chi tiết sản phẩm
// Nếu là "variant" thì dẫn đến trang giỏ hàng với 1 biến thể sản phẩm (variant)

// Dùng regex để trích ID từ gid://shopify/ProductVariant/12345678.
export function getDestinationUrl(qrCode) {
  if (qrCode.destination === "product") {
    return `https://${qrCode.shop}/products/${qrCode.productHandle}`;
  }

  const match = /gid:\/\/shopify\/ProductVariant\/([0-9]+)/.exec(
    qrCode.productVariantId,
  );
  invariant(match, "Unrecognized product variant ID");

  return `https://${qrCode.shop}/cart/${match[1]}:1`;
}

// Gọi Shopify GraphQL API để lấy thông tin sản phẩm (title, hình ảnh...).
async function supplementQRCode(qrCode, graphql) {
  // Gọi getQRCodeImage() để lấy hình QR (trả về Promise).
  const qrCodeImagePromise = getQRCodeImage(qrCode.id);

  const response = await graphql(
    `
      query supplementQRCode($id: ID!) {
        product(id: $id) {
          title
          media(first: 1) {
            nodes {
              ... on MediaImage {
                image {
                  altText
                  url
                }
              }
            }
          }
        }
      }
    `,
    {
      variables: {
        id: qrCode.productId,
      },
    },
  );

  const {
    data: { product },
  } = await response.json();

  // Kết hợp dữ liệu từ qrCode, dữ liệu sản phẩm, đường dẫn đích và ảnh QR để trả về đối tượng đầy đủ.
  return {
    ...qrCode,
    productDeleted: !product?.title,
    productTitle: product?.title,
    productImage: product?.images?.nodes[0]?.url,
    productAlt: product?.images?.nodes[0]?.altText,
    destinationUrl: getDestinationUrl(qrCode),
    image: await qrCodeImagePromise,
  };
}

// Hàm xác thực dữ liệu đầu vào khi tạo/sửa mã QR.
export function validateQRCode(data) {
  const errors = {};

  if (!data.title) {
    errors.title = "Title is required";
  }

  if (!data.productId) {
    errors.productId = "Product is required";
  }

  if (!data.destination) {
    errors.destination = "Destination is required";
  }

  if (Object.keys(errors).length) {
    return errors;
  }
}
